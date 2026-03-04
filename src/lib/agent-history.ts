import { readdir, readFile, realpath, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { gunzip as gunzipCallback } from "node:zlib";
import { promisify } from "node:util";
import { naturalCompare } from "@/lib/beat-sort";
import { resolveInteractionLogRoot } from "@/lib/interaction-logger";
import type {
  AgentHistoryBeatSummary,
  AgentHistoryEntry,
  AgentHistoryInteractionType,
  AgentHistoryPayload,
  AgentHistorySession,
} from "@/lib/agent-history-types";

const gunzip = promisify(gunzipCallback);
const MAX_LINE_CHARS = 120_000;
const DEV_LOG_DIRNAME = ".foolery-logs";
const DOT_GIT = ".git";
const GITDIR_PREFIX = "gitdir:";
const CLAUDE_WORKTREES_SEGMENT = /^(.*?)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+(?:[\\/].*)?$/u;
const KNOTS_WORKTREE_SEGMENT = /^(.*?)[\\/]\.knots[\\/]_worktree(?:[\\/].*)?$/u;
const SIBLING_WORKTREE_PATTERN = /^(.*)-wt-[^\\/]+$/u;

interface AgentHistoryQuery {
  repoPath?: string;
  beadId?: string;
  beadRepoPath?: string;
  sinceHours?: number;
  logRoot?: string;
}

interface SessionStartLine {
  sessionId: string;
  interactionType: AgentHistoryInteractionType;
  repoPath: string;
  beadIds: string[];
  ts: string;
  agentName?: string;
  agentModel?: string;
}

interface SessionParseResult {
  start: SessionStartLine;
  updatedAt: string;
  endedAt?: string;
  status?: string;
  exitCode?: number | null;
  entries: AgentHistoryEntry[];
  titleHints: Map<string, string>;
  workflowStates: string[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseMillis(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function newerTimestamp(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return parseMillis(b) > parseMillis(a) ? b : a;
}

function clipText(text: string): string {
  if (text.length <= MAX_LINE_CHARS) return text;
  const extra = text.length - MAX_LINE_CHARS;
  return `${text.slice(0, MAX_LINE_CHARS)}\n... [truncated ${extra} chars]`;
}

function beadKey(repoPath: string, beadId: string): string {
  return `${repoPath}::${beadId}`;
}

function devLogRootForRepoPath(repoPath: string): string | null {
  const trimmed = repoPath.trim();
  if (!trimmed) return null;
  return join(trimmed, DEV_LOG_DIRNAME);
}

function inferCanonicalRepoPath(repoPath: string): string | null {
  const trimmed = trimPathSeparators(repoPath.trim());
  if (!trimmed) return null;

  const claudeMatch = trimmed.match(CLAUDE_WORKTREES_SEGMENT);
  if (claudeMatch?.[1]) {
    return trimPathSeparators(claudeMatch[1]);
  }

  const knotsWorktreeMatch = trimmed.match(KNOTS_WORKTREE_SEGMENT);
  if (knotsWorktreeMatch?.[1]) {
    return trimPathSeparators(knotsWorktreeMatch[1]);
  }

  const baseName = basename(trimmed);
  const siblingMatch = baseName.match(SIBLING_WORKTREE_PATTERN);
  if (siblingMatch?.[1]) {
    return trimPathSeparators(join(dirname(trimmed), siblingMatch[1]));
  }

  return null;
}

async function listSubdirectories(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
}

async function discoverRelatedRepoPaths(repoPath: string): Promise<string[]> {
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

    const siblingCandidates = await listSubdirectories(dirname(baseRoot));
    const siblingPrefix = `${basename(baseRoot)}-wt-`;
    for (const siblingPath of siblingCandidates) {
      const siblingName = basename(siblingPath);
      if (siblingName.startsWith(siblingPrefix)) {
        related.add(trimPathSeparators(siblingPath));
      }
    }

    const claudeWorktrees = await listSubdirectories(join(baseRoot, ".claude", "worktrees"));
    for (const worktreePath of claudeWorktrees) {
      related.add(trimPathSeparators(worktreePath));
    }
  }

  return Array.from(related.values());
}

function trimPathSeparators(value: string): string {
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

/**
 * Fast lexical heuristics for common worktree path layouts.
 * Used as a fallback when paths no longer exist on disk.
 */
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

async function resolveGitDir(repoPath: string): Promise<string | null> {
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

  const firstLine = dotGitContent.split(/\r?\n/u, 1)[0]?.trim() ?? "";
  if (!firstLine.toLowerCase().startsWith(GITDIR_PREFIX)) {
    return null;
  }

  const gitDirRaw = firstLine.slice(GITDIR_PREFIX.length).trim();
  if (!gitDirRaw) return null;
  return isAbsolute(gitDirRaw) ? gitDirRaw : resolve(repoPath, gitDirRaw);
}

async function resolveCommonGitDir(gitDir: string): Promise<string> {
  const commonDirPath = join(gitDir, "commondir");
  try {
    const raw = (await readFile(commonDirPath, "utf-8")).trim();
    if (!raw) return gitDir;
    return isAbsolute(raw) ? raw : resolve(gitDir, raw);
  } catch {
    return gitDir;
  }
}

async function resolveRepoIdentity(repoPath: string): Promise<string | null> {
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

async function repoPathsEquivalent(
  a: string,
  b: string,
  cache: Map<string, Promise<string | null>>,
): Promise<boolean> {
  const left = trimPathSeparators(a.trim());
  const right = trimPathSeparators(b.trim());
  if (!left || !right) return false;
  if (left === right) return true;
  if (likelySameRepoPath(left, right)) return true;

  const [leftIdentity, rightIdentity] = await Promise.all([
    getRepoIdentity(left, cache),
    getRepoIdentity(right, cache),
  ]);
  return Boolean(leftIdentity && rightIdentity && leftIdentity === rightIdentity);
}

async function resolveHistoryLogRoots(query: AgentHistoryQuery): Promise<string[]> {
  if (query.logRoot) {
    return [query.logRoot];
  }

  const roots = new Set<string>([resolveInteractionLogRoot()]);
  const repoCandidates = new Set<string>();
  for (const repoPath of [query.repoPath, query.beadRepoPath]) {
    if (!repoPath) continue;
    const relatedRepoPaths = await discoverRelatedRepoPaths(repoPath);
    for (const relatedRepoPath of relatedRepoPaths) {
      repoCandidates.add(relatedRepoPath);
    }
  }

  for (const repoCandidate of repoCandidates) {
    const devRoot = devLogRootForRepoPath(repoCandidate);
    if (!devRoot) continue;
    roots.add(devRoot);
  }

  return Array.from(roots.values());
}

async function collectLogFiles(dir: string, out: string[]): Promise<void> {
  let entries: Dirent[] = [];
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" });
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
    if (entry.name.endsWith(".jsonl") || entry.name.endsWith(".jsonl.gz")) {
      out.push(fullPath);
    }
  }
}

async function readLogFile(filePath: string): Promise<string | null> {
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

function extractBeadTitles(prompt: string): Map<string, string> {
  const result = new Map<string, string>();
  const pairRegex = /(?:^|\n)(?:Parent ID|ID):\s*([^\n]+)\n(?:Parent Title|Title):\s*([^\n]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pairRegex.exec(prompt)) !== null) {
    const beadId = match[1]?.trim();
    const title = match[2]?.trim();
    if (!beadId || !title) continue;
    result.set(beadId, title);
  }
  return result;
}

function parseSession(
  content: string,
  query: AgentHistoryQuery,
): SessionParseResult | null {
  const lines = content.split("\n");
  let start: SessionStartLine | null = null;
  let capturesEntries = false;
  let updatedAt = "";
  let endedAt: string | undefined;
  let status: string | undefined;
  let exitCode: number | null | undefined;
  let promptCounter = 0;
  let pendingPromptState: string | undefined;
  let pendingPromptNumber: number | undefined;
  const entries: AgentHistoryEntry[] = [];
  const titleHints = new Map<string, string>();
  const workflowStates = new Set<string>();

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line.trim()) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const kind = typeof parsed.kind === "string" ? parsed.kind : "";
    const sessionId = typeof parsed.sessionId === "string" ? parsed.sessionId : "";
    const ts = typeof parsed.ts === "string" ? parsed.ts : "";

    if (kind === "session_start") {
      const rawType = parsed.interactionType;
      if (
        rawType !== "take" &&
        rawType !== "scene" &&
        rawType !== "verification" &&
        rawType !== "direct" &&
        rawType !== "breakdown"
      ) {
        return null;
      }
      const interactionType: AgentHistoryInteractionType = rawType;

      const repoPath = typeof parsed.repoPath === "string" ? parsed.repoPath : "";
      if (!repoPath) return null;

      // Accept both field names: beadIds (legacy) and beatIds (current logger output)
      const rawBeadIds = Array.isArray(parsed.beadIds)
        ? parsed.beadIds
        : Array.isArray(parsed.beatIds)
          ? parsed.beatIds
          : [];
      const beadIds = rawBeadIds.filter(isNonEmptyString).map((value) => value.trim());
      if (beadIds.length === 0) return null;

      start = {
        sessionId: sessionId || "unknown",
        interactionType,
        repoPath,
        beadIds,
        ts: ts || new Date(0).toISOString(),
        agentName: typeof parsed.agentName === "string" ? parsed.agentName : undefined,
        agentModel: typeof parsed.agentModel === "string" ? parsed.agentModel : undefined,
      };

      updatedAt = newerTimestamp(updatedAt, start.ts);
      capturesEntries = Boolean(query.beadId && beadIds.includes(query.beadId));

      if (capturesEntries) {
        entries.push({
          id: `${start.sessionId}:session_start:${lineIndex}`,
          kind: "session_start",
          ts: start.ts,
        });
      }
      continue;
    }

    if (!start || !kind) continue;
    if (sessionId && sessionId !== start.sessionId) continue;

    if (ts) {
      updatedAt = newerTimestamp(updatedAt, ts);
    }

    if (kind === "prompt") {
      promptCounter += 1;
      const prompt = typeof parsed.prompt === "string" ? parsed.prompt : "";
      if (prompt) {
        const hints = extractBeadTitles(prompt);
        for (const [beadId, title] of hints.entries()) {
          if (!start.beadIds.includes(beadId)) continue;
          if (!titleHints.has(beadId)) titleHints.set(beadId, title);
        }
      }
      if (!capturesEntries || !prompt) continue;
      const promptSource = typeof parsed.source === "string" ? parsed.source : undefined;
      const promptNumber =
        typeof pendingPromptNumber === "number" && pendingPromptNumber > 0
          ? pendingPromptNumber
          : promptCounter;
      entries.push({
        id: `${start.sessionId}:prompt:${lineIndex}`,
        kind: "prompt",
        ts: ts || start.ts,
        prompt: clipText(prompt),
        ...(promptSource ? { promptSource } : {}),
        promptNumber,
        ...(pendingPromptState ? { workflowState: pendingPromptState } : {}),
      });
      pendingPromptNumber = undefined;
      continue;
    }

    if (kind === "response") {
      if (!capturesEntries) continue;
      const raw =
        typeof parsed.raw === "string"
          ? parsed.raw
          : parsed.parsed !== undefined
            ? JSON.stringify(parsed.parsed)
            : JSON.stringify(parsed);
      entries.push({
        id: `${start.sessionId}:response:${lineIndex}`,
        kind: "response",
        ts: ts || start.ts,
        raw: clipText(raw),
      });
      continue;
    }

    if (kind === "beat_state") {
      if (!capturesEntries) continue;
      const state = typeof parsed.state === "string" ? parsed.state.trim() : "";
      if (state) {
        workflowStates.add(state);
      }
      const phase = typeof parsed.phase === "string" ? parsed.phase.trim() : "";
      const iteration =
        typeof parsed.iteration === "number" &&
        Number.isInteger(parsed.iteration) &&
        parsed.iteration > 0
          ? parsed.iteration
          : undefined;
      if (phase === "before_prompt") {
        if (state) {
          pendingPromptState = state;
        }
        if (iteration !== undefined) {
          pendingPromptNumber = iteration;
        }
      }
      continue;
    }

    if (kind === "session_end") {
      endedAt = ts || endedAt;
      status = typeof parsed.status === "string" ? parsed.status : status;
      if (typeof parsed.exitCode === "number" || parsed.exitCode === null) {
        exitCode = parsed.exitCode;
      }
      if (!capturesEntries) continue;
      entries.push({
        id: `${start.sessionId}:session_end:${lineIndex}`,
        kind: "session_end",
        ts: ts || start.ts,
        ...(status ? { status } : {}),
        ...(exitCode !== undefined ? { exitCode } : {}),
      });
    }
  }

  if (!start) return null;

  return {
    start,
    updatedAt: updatedAt || start.ts,
    endedAt,
    status,
    exitCode,
    entries,
    titleHints,
    workflowStates: Array.from(workflowStates.values()).sort(naturalCompare),
  };
}

function sortEntries(entries: AgentHistoryEntry[]): AgentHistoryEntry[] {
  return [...entries].sort((a, b) => {
    const timeDiff = parseMillis(a.ts) - parseMillis(b.ts);
    if (timeDiff !== 0) return timeDiff;
    return naturalCompare(a.id, b.id);
  });
}

function sortBeats(beats: AgentHistoryBeatSummary[]): AgentHistoryBeatSummary[] {
  return [...beats].sort((a, b) => {
    const timeDiff = parseMillis(b.lastWorkedAt) - parseMillis(a.lastWorkedAt);
    if (timeDiff !== 0) return timeDiff;
    const idDiff = naturalCompare(a.beadId, b.beadId);
    if (idDiff !== 0) return idDiff;
    return naturalCompare(a.repoPath, b.repoPath);
  });
}

function sortSessions(sessions: AgentHistorySession[]): AgentHistorySession[] {
  return [...sessions].sort((a, b) => {
    const timeDiff = parseMillis(b.updatedAt) - parseMillis(a.updatedAt);
    if (timeDiff !== 0) return timeDiff;
    return naturalCompare(a.sessionId, b.sessionId);
  });
}

export async function readAgentHistory(
  query: AgentHistoryQuery = {},
): Promise<AgentHistoryPayload> {
  const logFileSet = new Set<string>();
  const roots = await resolveHistoryLogRoots(query);
  for (const root of roots) {
    const filesForRoot: string[] = [];
    await collectLogFiles(root, filesForRoot);
    for (const filePath of filesForRoot) {
      logFileSet.add(filePath);
    }
  }
  const logFiles = Array.from(logFileSet.values()).sort(naturalCompare);

  const beatMap = new Map<string, AgentHistoryBeatSummary>();
  const selectedSessions: AgentHistorySession[] = [];
  const seenSessions = new Set<string>();
  const repoIdentityCache = new Map<string, Promise<string | null>>();
  const sinceHours =
    typeof query.sinceHours === "number" && Number.isFinite(query.sinceHours)
      ? query.sinceHours
      : undefined;
  const recencyThresholdMs =
    typeof sinceHours === "number" && sinceHours > 0
      ? Date.now() - sinceHours * 60 * 60 * 1000
      : undefined;

  for (const filePath of logFiles) {
    const content = await readLogFile(filePath);
    if (!content) continue;

    const parsed = parseSession(content, query);
    if (!parsed) continue;

    const { start, updatedAt, endedAt, status, exitCode, entries, titleHints, workflowStates } = parsed;
    let effectiveRepoPath = start.repoPath;
    if (query.repoPath) {
      const matchesRepo = await repoPathsEquivalent(query.repoPath, start.repoPath, repoIdentityCache);
      if (!matchesRepo) continue;
      effectiveRepoPath = query.repoPath;
    }

    const sessionKey = `${effectiveRepoPath}::${start.sessionId}::${start.ts}`;
    if (seenSessions.has(sessionKey)) {
      continue;
    }
    seenSessions.add(sessionKey);

    for (const beadId of start.beadIds) {
      const key = beadKey(effectiveRepoPath, beadId);
      const existing = beatMap.get(key);
      if (existing) {
        existing.lastWorkedAt = newerTimestamp(existing.lastWorkedAt, updatedAt);
        existing.sessionCount += 1;
        if (start.interactionType === "take") existing.takeCount += 1;
        else if (start.interactionType === "scene") existing.sceneCount += 1;
        else if (start.interactionType === "direct") existing.directCount += 1;
        else if (start.interactionType === "breakdown") existing.breakdownCount += 1;
        if (!existing.title && titleHints.has(beadId)) {
          existing.title = titleHints.get(beadId);
        }
      } else {
        beatMap.set(key, {
          beadId,
          repoPath: effectiveRepoPath,
          title: titleHints.get(beadId),
          lastWorkedAt: updatedAt,
          sessionCount: 1,
          takeCount: start.interactionType === "take" ? 1 : 0,
          sceneCount: start.interactionType === "scene" ? 1 : 0,
          directCount: start.interactionType === "direct" ? 1 : 0,
          breakdownCount: start.interactionType === "breakdown" ? 1 : 0,
        });
      }
    }

    let selectedRepoMatches = true;
    if (query.beadRepoPath) {
      selectedRepoMatches = await repoPathsEquivalent(
        query.beadRepoPath,
        start.repoPath,
        repoIdentityCache,
      );
    }
    const isSelected = Boolean(query.beadId && start.beadIds.includes(query.beadId) && selectedRepoMatches);

    if (isSelected) {
      selectedSessions.push({
        sessionId: start.sessionId,
        interactionType: start.interactionType,
        repoPath: effectiveRepoPath,
        beadIds: start.beadIds,
        startedAt: start.ts,
        updatedAt,
        endedAt,
        status,
        exitCode,
        entries: sortEntries(entries),
        agentName: start.agentName,
        agentModel: start.agentModel,
        workflowStates,
      });
    }
  }

  const beats = Array.from(beatMap.values());
  const filteredBeats =
    recencyThresholdMs !== undefined
      ? beats.filter((beat) => parseMillis(beat.lastWorkedAt) >= recencyThresholdMs)
      : beats;

  return {
    beats: sortBeats(filteredBeats),
    sessions: sortSessions(selectedSessions),
    selectedBeadId: query.beadId,
    selectedRepoPath: query.beadRepoPath ?? query.repoPath,
  };
}
