/**
 * Internal types, constants, session store, and small utilities for the
 * orchestration subsystem.
 *
 * Nothing in this file is part of the public API -- consumers should
 * import from `@/lib/orchestration-manager` instead.
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { getBackend } from "@/lib/backend-instance";
import type { InteractionLog } from "@/lib/interaction-logger";
import { ORCHESTRATION_WAVE_LABEL } from "@/lib/wave-slugs";
import type {
  Beat,
  OrchestrationEvent,
  OrchestrationWave,
} from "@/lib/types";

// Re-export plan helpers and lifecycle so dependents can import
// from this single module when convenient.
export {
  extractObjectiveBeatIds,
  derivePromptScope,
  buildPrompt,
  normalizeAgents,
  normalizeWave,
  normalizePlan,
  buildDraftPlan,
  extractPlanFromTaggedJson,
  applyLineEvent,
  formatStructuredLogLine,
  consumeAssistantText,
  summarizeResult,
} from "@/lib/orchestration-plan-helpers";

export {
  finalizeSession,
} from "@/lib/orchestration-session-lifecycle";

// ── Shared types ────────────────────────────────────────────────────

export interface OrchestrationSessionEntry {
  session: import("@/lib/types").OrchestrationSession;
  process: ChildProcess | null;
  emitter: EventEmitter;
  buffer: OrchestrationEvent[];
  allBeats: Map<string, Beat>;
  draftWaves: Map<number, OrchestrationWave>;
  assistantText: string;
  lineBuffer: string;
  exited: boolean;
  interactionLog: InteractionLog;
}

export type JsonObject = Record<string, unknown>;

export interface PromptScopeBeat {
  id: string;
  title: string;
  type: Beat["type"];
  state: Beat["state"];
  priority: Beat["priority"];
  description?: string;
}

export interface PromptDependencyEdge {
  blockerId: string;
  blockedId: string;
}

// ── Constants ───────────────────────────────────────────────────────

export const MAX_BUFFER = 5000;
export const CLEANUP_DELAY_MS = 10 * 60 * 1000;
export const ORCHESTRATION_JSON_TAG = "orchestration_plan_json";

// ── Global session store ────────────────────────────────────────────

const g = globalThis as unknown as {
  __orchestrationSessions?: Map<
    string,
    OrchestrationSessionEntry
  >;
};
if (!g.__orchestrationSessions) {
  g.__orchestrationSessions = new Map();
}
export const sessions = g.__orchestrationSessions;

// ── Small utility functions ─────────────────────────────────────────

export function generateId(): string {
  return (
    `orch-${Date.now()}-` +
    `${Math.random().toString(36).slice(2, 8)}`
  );
}

export function toObject(
  value: unknown,
): JsonObject | null {
  if (!value || typeof value !== "object") return null;
  return value as JsonObject;
}

export function toInt(
  value: unknown,
  fallback: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

export function dedupeBeats(items: Beat[]): Beat[] {
  const byId = new Map<string, Beat>();
  for (const beat of items) {
    if (!byId.has(beat.id)) byId.set(beat.id, beat);
  }
  return Array.from(byId.values());
}

export function toPromptScopeBeats(
  beats: Beat[],
): PromptScopeBeat[] {
  return beats
    .map((beat) => ({
      id: beat.id,
      title: beat.title,
      type: beat.type,
      state: beat.state,
      priority: beat.priority,
      description: beat.description,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeBeatIds(beatIds: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const beatId of beatIds) {
    const trimmed = beatId.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

async function collectPromptDependencyEdges(
  repoPath: string,
  beats: Beat[],
): Promise<PromptDependencyEdge[]> {
  const inScopeIds = new Set(beats.map((beat) => beat.id));
  const edgeKeys = new Set<string>();
  const edges: PromptDependencyEdge[] = [];

  const dependencyResults = await Promise.all(
    beats.map((beat) =>
      getBackend().listDependencies(
        beat.id,
        repoPath,
        { type: "blocks" },
      ),
    ),
  );

  for (const result of dependencyResults) {
    if (!result.ok) {
      throw new Error(
        result.error?.message ??
          "Failed to load dependency edges for orchestration",
      );
    }
    for (const dependency of result.data ?? []) {
      const blockerId = dependency.source?.trim();
      const blockedId = dependency.target?.trim();
      if (!blockerId || !blockedId) continue;
      if (
        !inScopeIds.has(blockerId) ||
        !inScopeIds.has(blockedId)
      ) {
        continue;
      }
      const edgeKey = `${blockerId}->${blockedId}`;
      if (edgeKeys.has(edgeKey)) continue;
      edgeKeys.add(edgeKey);
      edges.push({ blockerId, blockedId });
    }
  }

  edges.sort((left, right) => {
    const blocker = left.blockerId.localeCompare(
      right.blockerId,
    );
    if (blocker !== 0) return blocker;
    return left.blockedId.localeCompare(right.blockedId);
  });

  return edges;
}

// ── Event helpers ───────────────────────────────────────────────────

export function pushEvent(
  entry: OrchestrationSessionEntry,
  type: OrchestrationEvent["type"],
  data: OrchestrationEvent["data"],
) {
  const evt: OrchestrationEvent = {
    type,
    data,
    timestamp: Date.now(),
  };

  if (entry.buffer.length >= MAX_BUFFER) {
    entry.buffer.shift();
  }
  entry.buffer.push(evt);
  entry.emitter.emit("data", evt);
}

// ── Beat collection helpers ─────────────────────────────────────────

export async function collectEligibleBeats(
  repoPath: string,
  options?: { excludeOrchestrationWaves?: boolean },
): Promise<Beat[]> {
  const [open, inProgress, blocked] = await Promise.all([
    getBackend().list({ state: "open" }, repoPath),
    getBackend().list({ state: "in_progress" }, repoPath),
    getBackend().list({ state: "blocked" }, repoPath),
  ]);

  for (const result of [open, inProgress, blocked]) {
    if (!result.ok) {
      throw new Error(
        result.error?.message ??
          "Failed to load beats for orchestration",
      );
    }
  }

  const beats = dedupeBeats([
    ...(open.data ?? []),
    ...(inProgress.data ?? []),
    ...(blocked.data ?? []),
  ]);
  if (!options?.excludeOrchestrationWaves) return beats;
  return beats.filter(
    (beat) =>
      !(
        beat.labels?.includes(ORCHESTRATION_WAVE_LABEL) ??
        false
      ),
  );
}

export async function collectContext(
  repoPath: string,
): Promise<{
  beats: Beat[];
  edges: PromptDependencyEdge[];
}> {
  const beats = await collectEligibleBeats(repoPath, {
    excludeOrchestrationWaves: true,
  });
  const inScopeIds = new Set(beats.map((beat) => beat.id));
  const edgeKeys = new Set<string>();
  const edges: PromptDependencyEdge[] = [];

  const dependencyResults = await Promise.all(
    beats.map((beat) =>
      getBackend().listDependencies(
        beat.id,
        repoPath,
        { type: "blocks" },
      ),
    ),
  );

  for (const result of dependencyResults) {
    if (!result.ok) {
      throw new Error(
        result.error?.message ??
          "Failed to load dependency edges for orchestration",
      );
    }
    for (const dependency of result.data ?? []) {
      const blockerId = dependency.source?.trim();
      const blockedId = dependency.target?.trim();
      if (!blockerId || !blockedId) continue;
      if (
        !inScopeIds.has(blockerId) ||
        !inScopeIds.has(blockedId)
      ) {
        continue;
      }
      const edgeKey = `${blockerId}->${blockedId}`;
      if (edgeKeys.has(edgeKey)) continue;
      edgeKeys.add(edgeKey);
      edges.push({ blockerId, blockedId });
    }
  }

  edges.sort((left, right) => {
    const blocker = left.blockerId.localeCompare(
      right.blockerId,
    );
    if (blocker !== 0) return blocker;
    return left.blockedId.localeCompare(right.blockedId);
  });

  return { beats, edges };
}

export async function collectExplicitContext(
  repoPath: string,
  beatIds: string[],
): Promise<{
  beats: Beat[];
  edges: PromptDependencyEdge[];
  missingBeatIds: string[];
}> {
  const selectedBeatIds = normalizeBeatIds(beatIds);
  const resolved: Beat[] = [];
  const missingBeatIds: string[] = [];

  const results = await Promise.all(
    selectedBeatIds.map(async (beatId) => ({
      beatId,
      result: await getBackend().get(beatId, repoPath),
    })),
  );

  for (const { beatId, result } of results) {
    if (!result.ok || !result.data) {
      missingBeatIds.push(beatId);
      continue;
    }
    resolved.push(result.data);
  }

  const edges = await collectPromptDependencyEdges(
    repoPath,
    resolved,
  );

  return { beats: resolved, edges, missingBeatIds };
}
