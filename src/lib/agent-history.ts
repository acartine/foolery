import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { gunzip as gunzipCallback } from "node:zlib";
import { promisify } from "node:util";
import { naturalCompare } from "@/lib/bead-sort";
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
}

interface SessionParseResult {
  start: SessionStartLine;
  updatedAt: string;
  endedAt?: string;
  status?: string;
  exitCode?: number | null;
  entries: AgentHistoryEntry[];
  titleHints: Map<string, string>;
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
  let selectedSession = false;
  let updatedAt = "";
  let endedAt: string | undefined;
  let status: string | undefined;
  let exitCode: number | null | undefined;
  const entries: AgentHistoryEntry[] = [];
  const titleHints = new Map<string, string>();

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
      const interactionType = parsed.interactionType;
      if (interactionType !== "take" && interactionType !== "scene") {
        return null;
      }

      const repoPath = typeof parsed.repoPath === "string" ? parsed.repoPath : "";
      if (!repoPath) return null;
      if (query.repoPath && query.repoPath !== repoPath) return null;

      const beadIds = Array.isArray(parsed.beadIds)
        ? parsed.beadIds.filter(isNonEmptyString).map((value) => value.trim())
        : [];
      if (beadIds.length === 0) return null;

      start = {
        sessionId: sessionId || "unknown",
        interactionType,
        repoPath,
        beadIds,
        ts: ts || new Date(0).toISOString(),
      };

      updatedAt = newerTimestamp(updatedAt, start.ts);
      selectedSession = Boolean(
        query.beadId &&
          beadIds.includes(query.beadId) &&
          (!query.beadRepoPath || query.beadRepoPath === repoPath),
      );

      if (selectedSession) {
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
      const prompt = typeof parsed.prompt === "string" ? parsed.prompt : "";
      if (prompt) {
        const hints = extractBeadTitles(prompt);
        for (const [beadId, title] of hints.entries()) {
          if (!start.beadIds.includes(beadId)) continue;
          if (!titleHints.has(beadId)) titleHints.set(beadId, title);
        }
      }
      if (!selectedSession || !prompt) continue;
      const promptSource = typeof parsed.source === "string" ? parsed.source : undefined;
      entries.push({
        id: `${start.sessionId}:prompt:${lineIndex}`,
        kind: "prompt",
        ts: ts || start.ts,
        prompt: clipText(prompt),
        ...(promptSource ? { promptSource } : {}),
      });
      continue;
    }

    if (kind === "response") {
      if (!selectedSession) continue;
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

    if (kind === "session_end") {
      endedAt = ts || endedAt;
      status = typeof parsed.status === "string" ? parsed.status : status;
      if (typeof parsed.exitCode === "number" || parsed.exitCode === null) {
        exitCode = parsed.exitCode;
      }
      if (!selectedSession) continue;
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
  const root = query.logRoot ?? resolveInteractionLogRoot();
  const logFiles: string[] = [];
  await collectLogFiles(root, logFiles);

  const beatMap = new Map<string, AgentHistoryBeatSummary>();
  const selectedSessions: AgentHistorySession[] = [];
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

    const { start, updatedAt, endedAt, status, exitCode, entries, titleHints } = parsed;

    for (const beadId of start.beadIds) {
      const key = beadKey(start.repoPath, beadId);
      const existing = beatMap.get(key);
      if (existing) {
        existing.lastWorkedAt = newerTimestamp(existing.lastWorkedAt, updatedAt);
        existing.sessionCount += 1;
        if (start.interactionType === "take") existing.takeCount += 1;
        else existing.sceneCount += 1;
        if (!existing.title && titleHints.has(beadId)) {
          existing.title = titleHints.get(beadId);
        }
      } else {
        beatMap.set(key, {
          beadId,
          repoPath: start.repoPath,
          title: titleHints.get(beadId),
          lastWorkedAt: updatedAt,
          sessionCount: 1,
          takeCount: start.interactionType === "take" ? 1 : 0,
          sceneCount: start.interactionType === "scene" ? 1 : 0,
        });
      }
    }

    const isSelected = Boolean(
      query.beadId &&
        start.beadIds.includes(query.beadId) &&
        (!query.beadRepoPath || query.beadRepoPath === start.repoPath),
    );

    if (isSelected) {
      selectedSessions.push({
        sessionId: start.sessionId,
        interactionType: start.interactionType,
        repoPath: start.repoPath,
        beadIds: start.beadIds,
        startedAt: start.ts,
        updatedAt,
        endedAt,
        status,
        exitCode,
        entries: sortEntries(entries),
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
