import {
  isOverviewBeat,
  overviewTabForBeat,
} from "@/lib/beat-state-overview";
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
  beat: Pick<Beat, "updated">,
  nowMs: number,
): number | null {
  const updatedMs = Date.parse(beat.updated);
  if (!Number.isFinite(updatedMs)) return null;
  if (!Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.floor((nowMs - updatedMs) / MS_PER_DAY));
}

export function staleBeatCreatedAgeDays(
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
  const updatedMs = Date.parse(beat.updated);
  if (!Number.isFinite(updatedMs)) return false;
  return nowMs - updatedMs > ageDays * MS_PER_DAY;
}

export function getStaleBeatSummaries(
  beats: readonly Beat[],
  nowMs: number,
  ageDays = STALE_BEAT_AGE_DAYS,
): StaleBeatSummary[] {
  return beats
    .filter((beat) => isStaleBeat(beat, nowMs, ageDays))
    .sort(compareBeatsByOldestUpdated)
    .map((beat) => staleBeatSummary(beat, nowMs))
    .filter((summary): summary is StaleBeatSummary =>
      summary !== null);
}

export function selectOldestStaleBeatSummaries(
  summaries: readonly StaleBeatSummary[],
  limit: number,
): StaleBeatSummary[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  return summaries.slice(0, Math.floor(limit));
}

export function buildStaleBeatReviewRequest(input: {
  summaries: readonly StaleBeatSummary[];
  selectedKeys: ReadonlySet<string>;
  agentId?: string;
}): StaleBeatReviewRequest {
  const agentId = input.agentId?.trim();
  const targets = input.summaries
    .filter((summary) => input.selectedKeys.has(summary.key))
    .map((summary) => ({
      beatId: summary.beatId,
      ...(summary.repoPath
        ? { repoPath: summary.repoPath }
        : {}),
    }));
  return {
    targets,
    ...(agentId ? { agentId } : {}),
  };
}

function staleBeatSummary(
  beat: Beat,
  nowMs: number,
): StaleBeatSummary | null {
  const ageDays = staleBeatAgeDays(beat, nowMs);
  if (ageDays === null) return null;
  const createdAgeDays = staleBeatCreatedAgeDays(beat, nowMs);
  const repoPath = beatRepoPath(beat);
  const target = { beatId: beat.id, repoPath };
  return {
    key: staleBeatTargetKey(target),
    beatId: beat.id,
    title: beat.title,
    state: beat.state,
    ageDays,
    createdAgeDays,
    created: beat.created,
    updated: beat.updated,
    beat,
    ...(repoPath ? { repoPath } : {}),
    ...(beatRepoName(beat)
      ? { repoName: beatRepoName(beat) }
      : {}),
  };
}

function compareBeatsByOldestUpdated(
  left: Beat,
  right: Beat,
): number {
  const leftUpdated = Date.parse(left.updated);
  const rightUpdated = Date.parse(right.updated);
  const leftTime = Number.isFinite(leftUpdated)
    ? leftUpdated
    : Number.POSITIVE_INFINITY;
  const rightTime = Number.isFinite(rightUpdated)
    ? rightUpdated
    : Number.POSITIVE_INFINITY;
  if (leftTime !== rightTime) return leftTime - rightTime;
  const titleOrder = left.title.localeCompare(right.title);
  if (titleOrder !== 0) return titleOrder;
  return left.id.localeCompare(right.id);
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
