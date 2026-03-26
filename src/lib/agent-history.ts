import { naturalCompare } from "@/lib/beat-sort";
import type {
  AgentHistoryBeatSummary,
  AgentHistoryEntry,
  AgentHistoryPayload,
  AgentHistorySession,
} from "@/lib/agent-history-types";
import {
  type AgentHistoryQuery,
  repoPathsEquivalent,
  resolveHistoryLogRoots,
  collectLogFiles,
  readLogFile,
} from "@/lib/agent-history-resolve";
import {
  type SessionStartLine,
  type SessionParseResult,
  parseSession,
  parseMillis,
  newerTimestamp,
} from "@/lib/agent-history-parse";

// ── Sort helpers ─────────────────────────────────────────────

function sortEntries(
  entries: AgentHistoryEntry[],
): AgentHistoryEntry[] {
  return [...entries].sort((a, b) => {
    const timeDiff = parseMillis(a.ts) - parseMillis(b.ts);
    if (timeDiff !== 0) return timeDiff;
    return naturalCompare(a.id, b.id);
  });
}

function sortBeats(
  beats: AgentHistoryBeatSummary[],
): AgentHistoryBeatSummary[] {
  return [...beats].sort((a, b) => {
    const td =
      parseMillis(b.lastWorkedAt) -
      parseMillis(a.lastWorkedAt);
    if (td !== 0) return td;
    const id = naturalCompare(a.beatId, b.beatId);
    if (id !== 0) return id;
    return naturalCompare(a.repoPath, b.repoPath);
  });
}

function sortSessions(
  sessions: AgentHistorySession[],
): AgentHistorySession[] {
  return [...sessions].sort((a, b) => {
    const td =
      parseMillis(b.updatedAt) - parseMillis(a.updatedAt);
    if (td !== 0) return td;
    return naturalCompare(a.sessionId, b.sessionId);
  });
}

// ── beatKey ──────────────────────────────────────────────────

function beatKey(repoPath: string, beatId: string): string {
  return `${repoPath}::${beatId}`;
}

// ── readAgentHistory ─────────────────────────────────────────

export async function readAgentHistory(
  query: AgentHistoryQuery = {},
): Promise<AgentHistoryPayload> {
  const logFiles = await gatherLogFiles(query);

  const beatMap = new Map<string, AgentHistoryBeatSummary>();
  const selectedSessions: AgentHistorySession[] = [];
  const seenSessions = new Set<string>();
  const idCache = new Map<string, Promise<string | null>>();
  const recencyThresholdMs = computeRecencyThreshold(query);

  for (const filePath of logFiles) {
    const content = await readLogFile(filePath);
    if (!content) continue;

    const parsed = parseSession(content, query);
    if (!parsed) continue;

    await processSession(
      parsed,
      query,
      beatMap,
      selectedSessions,
      seenSessions,
      idCache,
    );
  }

  const beats = Array.from(beatMap.values());
  const filteredBeats =
    recencyThresholdMs !== undefined
      ? beats.filter(
          (b) =>
            parseMillis(b.lastWorkedAt) >= recencyThresholdMs,
        )
      : beats;

  return {
    beats: sortBeats(filteredBeats),
    sessions: sortSessions(selectedSessions),
    selectedBeatId: query.beatId,
    selectedRepoPath: query.beatRepoPath ?? query.repoPath,
  };
}

// ── Sub-functions ────────────────────────────────────────────

async function gatherLogFiles(
  query: AgentHistoryQuery,
): Promise<string[]> {
  const logFileSet = new Set<string>();
  const roots = await resolveHistoryLogRoots(query);
  for (const root of roots) {
    const filesForRoot: string[] = [];
    await collectLogFiles(root, filesForRoot);
    for (const fp of filesForRoot) {
      logFileSet.add(fp);
    }
  }
  return Array.from(logFileSet.values()).sort(naturalCompare);
}

function computeRecencyThreshold(
  query: AgentHistoryQuery,
): number | undefined {
  const sinceHours =
    typeof query.sinceHours === "number" &&
    Number.isFinite(query.sinceHours)
      ? query.sinceHours
      : undefined;
  return typeof sinceHours === "number" && sinceHours > 0
    ? Date.now() - sinceHours * 60 * 60 * 1000
    : undefined;
}

async function processSession(
  parsed: SessionParseResult,
  query: AgentHistoryQuery,
  beatMap: Map<string, AgentHistoryBeatSummary>,
  selectedSessions: AgentHistorySession[],
  seenSessions: Set<string>,
  idCache: Map<string, Promise<string | null>>,
): Promise<void> {
  const { start, updatedAt, endedAt, status, exitCode } =
    parsed;
  const { entries, titleHints, workflowStates } = parsed;

  let effectiveRepoPath = start.repoPath;
  if (query.repoPath) {
    const matchesRepo = await repoPathsEquivalent(
      query.repoPath,
      start.repoPath,
      idCache,
    );
    if (!matchesRepo) return;
    effectiveRepoPath = query.repoPath;
  }

  const sessionKey =
    `${effectiveRepoPath}::${start.sessionId}::${start.ts}`;
  if (seenSessions.has(sessionKey)) return;
  seenSessions.add(sessionKey);

  updateBeatMap(
    start,
    effectiveRepoPath,
    updatedAt,
    titleHints,
    beatMap,
  );

  let selectedRepoMatches = true;
  if (query.beatRepoPath) {
    selectedRepoMatches = await repoPathsEquivalent(
      query.beatRepoPath,
      start.repoPath,
      idCache,
    );
  }
  const isSelected = Boolean(
    query.beatId &&
      start.beatIds.includes(query.beatId) &&
      selectedRepoMatches,
  );

  if (isSelected) {
    selectedSessions.push({
      sessionId: start.sessionId,
      interactionType: start.interactionType,
      repoPath: effectiveRepoPath,
      beatIds: start.beatIds,
      startedAt: start.ts,
      updatedAt,
      endedAt,
      status,
      exitCode,
      entries: sortEntries(entries),
      agentName: start.agentName,
      agentModel: start.agentModel,
      agentVersion: start.agentVersion,
      workflowStates,
    });
  }
}

function updateBeatMap(
  start: SessionStartLine,
  effectiveRepoPath: string,
  updatedAt: string,
  titleHints: Map<string, string>,
  beatMap: Map<string, AgentHistoryBeatSummary>,
): void {
  for (const beatId of start.beatIds) {
    const key = beatKey(effectiveRepoPath, beatId);
    const existing = beatMap.get(key);
    if (existing) {
      existing.lastWorkedAt = newerTimestamp(
        existing.lastWorkedAt,
        updatedAt,
      );
      existing.sessionCount += 1;
      incrementInteractionCount(existing, start);
      if (!existing.title && titleHints.has(beatId)) {
        existing.title = titleHints.get(beatId);
      }
    } else {
      beatMap.set(key, {
        beatId,
        repoPath: effectiveRepoPath,
        title: titleHints.get(beatId),
        lastWorkedAt: updatedAt,
        sessionCount: 1,
        takeCount:
          start.interactionType === "take" ? 1 : 0,
        sceneCount:
          start.interactionType === "scene" ? 1 : 0,
        directCount:
          start.interactionType === "direct" ? 1 : 0,
        breakdownCount:
          start.interactionType === "breakdown" ? 1 : 0,
      });
    }
  }
}

function incrementInteractionCount(
  beat: AgentHistoryBeatSummary,
  start: SessionStartLine,
): void {
  if (start.interactionType === "take") {
    beat.takeCount += 1;
  } else if (start.interactionType === "scene") {
    beat.sceneCount += 1;
  } else if (start.interactionType === "direct") {
    beat.directCount += 1;
  } else if (start.interactionType === "breakdown") {
    beat.breakdownCount += 1;
  }
}
