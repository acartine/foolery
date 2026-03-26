/**
 * Repo-path resolution, log file discovery, and identity
 * helpers for agent-history.
 *
 * Extracted from agent-history.ts to stay under 500 lines.
 */
import {
  readdir,
  readFile,
  realpath,
  stat,
} from "node:fs/promises";
import type { Dirent } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
} from "node:path";
import { gunzip as gunzipCallback } from "node:zlib";
import { promisify } from "node:util";
import { resolveInteractionLogRoot } from "@/lib/interaction-logger";

const gunzip = promisify(gunzipCallback);
const DEV_LOG_DIRNAME = ".foolery-logs";
const DOT_GIT = ".git";
const GITDIR_PREFIX = "gitdir:";
const CLAUDE_WORKTREES_SEGMENT =
  /^(.*?)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+(?:[\\/].*)?$/u;
const KNOTS_WORKTREE_SEGMENT =
  /^(.*?)[\\/]\.knots[\\/]_worktree(?:[\\/].*)?$/u;
const SIBLING_WORKTREE_PATTERN = /^(.*)-wt-[^\\/]+$/u;

export interface AgentHistoryQuery {
  repoPath?: string;
  beatId?: string;
  beatRepoPath?: string;
  sinceHours?: number;
  logRoot?: string;
}

// ── Path utilities ───────────────────────────────────────────

export function trimPathSeparators(value: string): string {
  return value.replace(/[\\/]+$/u, "");
}

function pathsSharePrefix(a: string, b: string): boolean {
  return (
    a === b ||
    b.startsWith(`${a}/`) ||
    b.startsWith(`${a}\\`) ||
    a.startsWith(`${b}/`) ||
    a.startsWith(`${b}\\`)
  );
}

function likelySameRepoPath(a: string, b: string): boolean {
  const left = trimPathSeparators(a);
  const right = trimPathSeparators(b);
  if (!left || !right) return false;
  if (pathsSharePrefix(left, right)) return true;

  const leftBase = basename(left);
  const rightBase = basename(right);
  const leftParent = dirname(left);
  const rightParent = dirname(right);
  if (leftParent === rightParent) {
    if (rightBase.startsWith(`${leftBase}-wt-`)) return true;
    if (leftBase.startsWith(`${rightBase}-wt-`)) return true;
  }

  return false;
}

function inferCanonicalRepoPath(
  repoPath: string,
): string | null {
  const trimmed = trimPathSeparators(repoPath.trim());
  if (!trimmed) return null;

  const claudeMatch = trimmed.match(CLAUDE_WORKTREES_SEGMENT);
  if (claudeMatch?.[1]) {
    return trimPathSeparators(claudeMatch[1]);
  }

  const knotsMatch = trimmed.match(KNOTS_WORKTREE_SEGMENT);
  if (knotsMatch?.[1]) {
    return trimPathSeparators(knotsMatch[1]);
  }

  const baseName = basename(trimmed);
  const siblingMatch = baseName.match(SIBLING_WORKTREE_PATTERN);
  if (siblingMatch?.[1]) {
    return trimPathSeparators(
      join(dirname(trimmed), siblingMatch[1]),
    );
  }

  return null;
}

function devLogRootForRepoPath(
  repoPath: string,
): string | null {
  const trimmed = repoPath.trim();
  if (!trimmed) return null;
  return join(trimmed, DEV_LOG_DIRNAME);
}

// ── Subdirectory / worktree discovery ────────────────────────

async function listSubdirectories(
  dir: string,
): Promise<string[]> {
  try {
    const entries = await readdir(dir, {
      withFileTypes: true,
      encoding: "utf8",
    });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => join(dir, e.name));
  } catch {
    return [];
  }
}

async function discoverRelatedRepoPaths(
  repoPath: string,
): Promise<string[]> {
  const trimmed = trimPathSeparators(repoPath.trim());
  if (!trimmed) return [];

  const baseRoots = new Set<string>([trimmed]);
  const canonicalPath = inferCanonicalRepoPath(trimmed);
  if (canonicalPath) {
    baseRoots.add(canonicalPath);
  }

  const related = new Set<string>(baseRoots);
  for (const baseRoot of baseRoots) {
    related.add(join(baseRoot, ".knots", "_worktree"));

    const siblings = await listSubdirectories(
      dirname(baseRoot),
    );
    const siblingPrefix = `${basename(baseRoot)}-wt-`;
    for (const siblingPath of siblings) {
      if (basename(siblingPath).startsWith(siblingPrefix)) {
        related.add(trimPathSeparators(siblingPath));
      }
    }

    const claudeWorktrees = await listSubdirectories(
      join(baseRoot, ".claude", "worktrees"),
    );
    for (const worktreePath of claudeWorktrees) {
      related.add(trimPathSeparators(worktreePath));
    }
  }

  return Array.from(related.values());
}

// ── Git identity resolution ──────────────────────────────────

async function resolveGitDir(
  repoPath: string,
): Promise<string | null> {
  const dotGitPath = join(repoPath, DOT_GIT);
  let dotGitStat;
  try {
    dotGitStat = await stat(dotGitPath);
  } catch {
    return null;
  }

  if (dotGitStat.isDirectory()) {
    return dotGitPath;
  }

  if (!dotGitStat.isFile()) {
    return null;
  }

  let dotGitContent: string;
  try {
    dotGitContent = await readFile(dotGitPath, "utf-8");
  } catch {
    return null;
  }

  const firstLine =
    dotGitContent.split(/\r?\n/u, 1)[0]?.trim() ?? "";
  if (!firstLine.toLowerCase().startsWith(GITDIR_PREFIX)) {
    return null;
  }

  const gitDirRaw = firstLine.slice(GITDIR_PREFIX.length).trim();
  if (!gitDirRaw) return null;
  return isAbsolute(gitDirRaw)
    ? gitDirRaw
    : resolve(repoPath, gitDirRaw);
}

async function resolveCommonGitDir(
  gitDir: string,
): Promise<string> {
  const commonDirPath = join(gitDir, "commondir");
  try {
    const raw = (
      await readFile(commonDirPath, "utf-8")
    ).trim();
    if (!raw) return gitDir;
    return isAbsolute(raw) ? raw : resolve(gitDir, raw);
  } catch {
    return gitDir;
  }
}

async function resolveRepoIdentity(
  repoPath: string,
): Promise<string | null> {
  const trimmed = trimPathSeparators(repoPath.trim());
  if (!trimmed) return null;

  const gitDir = await resolveGitDir(trimmed);
  if (!gitDir) return null;
  const commonDir = await resolveCommonGitDir(gitDir);
  try {
    return await realpath(commonDir);
  } catch {
    return trimPathSeparators(commonDir);
  }
}

function getRepoIdentity(
  repoPath: string,
  cache: Map<string, Promise<string | null>>,
): Promise<string | null> {
  const key = trimPathSeparators(repoPath.trim());
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = resolveRepoIdentity(key);
  cache.set(key, pending);
  return pending;
}

export async function repoPathsEquivalent(
  a: string,
  b: string,
  cache: Map<string, Promise<string | null>>,
): Promise<boolean> {
  const left = trimPathSeparators(a.trim());
  const right = trimPathSeparators(b.trim());
  if (!left || !right) return false;
  if (left === right) return true;
  if (likelySameRepoPath(left, right)) return true;

  const [leftId, rightId] = await Promise.all([
    getRepoIdentity(left, cache),
    getRepoIdentity(right, cache),
  ]);
  return Boolean(leftId && rightId && leftId === rightId);
}

// ── Log root resolution ──────────────────────────────────────

export async function resolveHistoryLogRoots(
  query: AgentHistoryQuery,
): Promise<string[]> {
  if (query.logRoot) {
    return [query.logRoot];
  }

  const roots = new Set<string>([
    resolveInteractionLogRoot(),
  ]);
  const repoCandidates = new Set<string>();
  for (const repoPath of [
    query.repoPath,
    query.beatRepoPath,
  ]) {
    if (!repoPath) continue;
    const related = await discoverRelatedRepoPaths(repoPath);
    for (const relatedPath of related) {
      repoCandidates.add(relatedPath);
    }
  }

  for (const repoCandidate of repoCandidates) {
    const devRoot = devLogRootForRepoPath(repoCandidate);
    if (!devRoot) continue;
    roots.add(devRoot);
  }

  return Array.from(roots.values());
}

// ── Log file collection ──────────────────────────────────────

export async function collectLogFiles(
  dir: string,
  out: string[],
): Promise<void> {
  let entries: Dirent[] = [];
  try {
    entries = await readdir(dir, {
      withFileTypes: true,
      encoding: "utf8",
    });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectLogFiles(fullPath, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (
      entry.name.endsWith(".jsonl") ||
      entry.name.endsWith(".jsonl.gz")
    ) {
      out.push(fullPath);
    }
  }
}

export async function readLogFile(
  filePath: string,
): Promise<string | null> {
  try {
    const raw = await readFile(filePath);
    if (filePath.endsWith(".gz")) {
      const unzipped = await gunzip(raw);
      return unzipped.toString("utf-8");
    }
    return raw.toString("utf-8");
  } catch {
    return null;
  }
}
