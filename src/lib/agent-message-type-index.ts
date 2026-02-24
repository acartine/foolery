/**
 * Agent message type index — tracks the unique set of top-level `type` values
 * found in agent responses across interaction logs.
 *
 * The index is persisted alongside other Foolery config so it survives between
 * sessions but is removed when Foolery is uninstalled (it lives inside the
 * same config directory).
 *
 * Build triggers:
 * - On startup when the index file is missing (via the API route).
 * - After every completed take/scene session (via terminal-manager hook).
 */

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { gunzip as gunzipCallback } from "node:zlib";
import { promisify } from "node:util";
import { resolveInteractionLogRoot } from "@/lib/interaction-logger";

const gunzip = promisify(gunzipCallback);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentMessageTypeAgent {
  agentName: string;
  agentModel?: string;
}

export interface AgentMessageTypeEntry {
  type: string;
  agents: AgentMessageTypeAgent[];
  firstSeen: string;
  lastSeen: string;
  count: number;
}

export interface AgentMessageTypeIndex {
  version: 1;
  builtAt: string;
  entries: AgentMessageTypeEntry[];
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function isDev(): boolean {
  return process.env.NODE_ENV === "development";
}

export function resolveIndexPath(): string {
  if (isDev()) {
    return join(process.cwd(), ".foolery-logs", "message-type-index.json");
  }
  return join(homedir(), ".config", "foolery", "message-type-index.json");
}

export async function readMessageTypeIndex(): Promise<AgentMessageTypeIndex | null> {
  try {
    const raw = await readFile(resolveIndexPath(), "utf-8");
    return JSON.parse(raw) as AgentMessageTypeIndex;
  } catch {
    return null;
  }
}

export async function writeMessageTypeIndex(index: AgentMessageTypeIndex): Promise<void> {
  const path = resolveIndexPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(index, null, 2), "utf-8");
}

export async function removeMessageTypeIndex(): Promise<void> {
  const { unlink } = await import("node:fs/promises");
  try {
    await unlink(resolveIndexPath());
  } catch {
    // Already gone — nothing to do.
  }
}

// ---------------------------------------------------------------------------
// Log file discovery
// ---------------------------------------------------------------------------

async function collectLogFiles(
  dir: string,
  out: Array<{ path: string; mtime: number }>,
): Promise<void> {
  let entries: Dirent[] = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
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
      const info = await stat(fullPath).catch(() => null);
      if (info) out.push({ path: fullPath, mtime: info.mtimeMs });
    }
  }
}

async function readLogContent(filePath: string): Promise<string | null> {
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

// ---------------------------------------------------------------------------
// Type extraction
// ---------------------------------------------------------------------------

function agentMatches(a: AgentMessageTypeAgent, b: AgentMessageTypeAgent): boolean {
  return a.agentName === b.agentName && (a.agentModel ?? "") === (b.agentModel ?? "");
}

function newerTimestamp(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return b > a ? b : a;
}

function olderTimestamp(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return b < a ? b : a;
}

/**
 * Extract message types from JSONL content and merge them into the provided map.
 */
function extractTypesFromContent(
  content: string,
  typeMap: Map<string, AgentMessageTypeEntry>,
  overrideAgent?: AgentMessageTypeAgent,
): void {
  let sessionAgent: AgentMessageTypeAgent | undefined = overrideAgent;

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const kind = typeof parsed.kind === "string" ? parsed.kind : "";
    const ts = typeof parsed.ts === "string" ? parsed.ts : new Date().toISOString();

    if (kind === "session_start" && !overrideAgent) {
      const agentName = typeof parsed.agentName === "string" ? parsed.agentName : undefined;
      const agentModel = typeof parsed.agentModel === "string" ? parsed.agentModel : undefined;
      if (agentName) {
        sessionAgent = { agentName, agentModel };
      }
      continue;
    }

    if (kind !== "response") continue;

    const rawField = parsed.raw;
    if (typeof rawField !== "string") continue;

    let rawParsed: Record<string, unknown>;
    try {
      rawParsed = JSON.parse(rawField) as Record<string, unknown>;
    } catch {
      continue;
    }

    const msgType = typeof rawParsed.type === "string" ? rawParsed.type : null;
    if (!msgType) continue;

    const existing = typeMap.get(msgType);
    if (existing) {
      existing.lastSeen = newerTimestamp(existing.lastSeen, ts);
      existing.firstSeen = olderTimestamp(existing.firstSeen, ts);
      existing.count += 1;
      if (sessionAgent && !existing.agents.some((a) => agentMatches(a, sessionAgent!))) {
        existing.agents.push({ ...sessionAgent });
      }
    } else {
      typeMap.set(msgType, {
        type: msgType,
        agents: sessionAgent ? [{ ...sessionAgent }] : [],
        firstSeen: ts,
        lastSeen: ts,
        count: 1,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a fresh index by scanning the most recent log files (up to `maxFiles`).
 *
 * The optional `logRoot` parameter exists primarily for testing.
 */
export async function buildMessageTypeIndex(
  logRoot?: string,
  maxFiles = 2,
): Promise<AgentMessageTypeIndex> {
  const root = logRoot ?? resolveInteractionLogRoot();
  const files: Array<{ path: string; mtime: number }> = [];
  await collectLogFiles(root, files);

  // Sort by mtime descending, take most recent N
  files.sort((a, b) => b.mtime - a.mtime);
  const recentFiles = files.slice(0, maxFiles);

  const typeMap = new Map<string, AgentMessageTypeEntry>();

  for (const file of recentFiles) {
    const content = await readLogContent(file.path);
    if (!content) continue;
    extractTypesFromContent(content, typeMap);
  }

  return {
    version: 1,
    builtAt: new Date().toISOString(),
    entries: Array.from(typeMap.values()).sort((a, b) => b.count - a.count),
  };
}

/**
 * Update the existing index with types extracted from a single session log file.
 *
 * If the index does not exist yet, it is created from scratch (just this file).
 */
export async function updateMessageTypeIndexFromSession(
  logFilePath: string,
  agentName?: string,
  agentModel?: string,
): Promise<void> {
  const existing = await readMessageTypeIndex();
  const typeMap = new Map<string, AgentMessageTypeEntry>();

  // Seed with existing entries
  if (existing) {
    for (const entry of existing.entries) {
      typeMap.set(entry.type, { ...entry, agents: [...entry.agents] });
    }
  }

  const content = await readLogContent(logFilePath);
  if (!content) return;

  const overrideAgent: AgentMessageTypeAgent | undefined = agentName
    ? { agentName, agentModel }
    : undefined;
  extractTypesFromContent(content, typeMap, overrideAgent);

  const index: AgentMessageTypeIndex = {
    version: 1,
    builtAt: new Date().toISOString(),
    entries: Array.from(typeMap.values()).sort((a, b) => b.count - a.count),
  };
  await writeMessageTypeIndex(index);
}
