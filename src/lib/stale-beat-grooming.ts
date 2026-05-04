import {
  isOverviewBeat,
  overviewTabForBeat,
} from "@/lib/beat-state-overview";
import { compareBeatsByPriorityThenUpdated } from "@/lib/beat-sort";
import type { Beat } from "@/lib/types";
import {
  STALE_BEAT_AGE_DAYS,
  type StaleBeatReviewRequest,
  type StaleBeatReviewTarget,
  type StaleBeatSummary,
} from "@/lib/stale-beat-grooming-types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function staleBeatTargetKey(
  target: Pick<StaleBeatReviewTarget, "beatId" | "repoPath">,
): string {
  return `${target.repoPath ?? ""}::${target.beatId}`;
}

export function beatRepoPath(beat: Beat): string | undefined {
  const value = (beat as { _repoPath?: unknown })._repoPath;
  return cleanString(value);
}

export function beatRepoName(beat: Beat): string | undefined {
  const value = (beat as { _repoName?: unknown })._repoName;
  return cleanString(value);
}

export function staleBeatAgeDays(
  beat: Pick<Beat, "created">,
  nowMs: number,
): number | null {
  const createdMs = Date.parse(beat.created);
  if (!Number.isFinite(createdMs)) return null;
  if (!Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.floor((nowMs - createdMs) / MS_PER_DAY));
}

export function isStaleBeat(
  beat: Beat,
  nowMs: number,
  ageDays = STALE_BEAT_AGE_DAYS,
): boolean {
  if (!isOverviewBeat(beat)) return false;
  if (overviewTabForBeat(beat) === "terminated") return false;
  const createdMs = Date.parse(beat.created);
  if (!Number.isFinite(createdMs)) return false;
  return nowMs - createdMs > ageDays * MS_PER_DAY;
}

export function getStaleBeatSummaries(
  beats: readonly Beat[],
  nowMs: number,
): StaleBeatSummary[] {
  return beats
    .filter((beat) => isStaleBeat(beat, nowMs))
    .sort(compareBeatsByPriorityThenUpdated)
    .map((beat) => staleBeatSummary(beat, nowMs))
    .filter((summary): summary is StaleBeatSummary =>
      summary !== null);
}

export function buildStaleBeatReviewRequest(input: {
  summaries: readonly StaleBeatSummary[];
  selectedKeys: ReadonlySet<string>;
  agentId: string;
  modelOverride?: string;
}): StaleBeatReviewRequest {
  const agentId = input.agentId.trim();
  const targets = input.summaries
    .filter((summary) => input.selectedKeys.has(summary.key))
    .map((summary) => ({
      beatId: summary.beatId,
      ...(summary.repoPath
        ? { repoPath: summary.repoPath }
        : {}),
    }));
  const modelOverride = input.modelOverride?.trim();
  return {
    agentId,
    targets,
    ...(modelOverride ? { modelOverride } : {}),
  };
}

function staleBeatSummary(
  beat: Beat,
  nowMs: number,
): StaleBeatSummary | null {
  const ageDays = staleBeatAgeDays(beat, nowMs);
  if (ageDays === null) return null;
  const repoPath = beatRepoPath(beat);
  const target = { beatId: beat.id, repoPath };
  return {
    key: staleBeatTargetKey(target),
    beatId: beat.id,
    title: beat.title,
    state: beat.state,
    ageDays,
    created: beat.created,
    beat,
    ...(repoPath ? { repoPath } : {}),
    ...(beatRepoName(beat)
      ? { repoName: beatRepoName(beat) }
      : {}),
  };
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
