import type { PlanSummary } from "@/lib/orchestration-plan-types";
import type { Beat } from "@/lib/types";
import { isInternalLabel } from "@/lib/wave-slugs";

export interface OverviewTagFilterOption {
  id: string;
  label: string;
  count: number;
}

export interface OverviewSetlistFilterOption {
  id: string;
  planId: string;
  repoPath?: string;
  title: string;
  label: string;
  beatIds: string[];
}

export interface OverviewFilterState {
  selectedTagIds: ReadonlySet<string>;
  selectedSetlistIds: ReadonlySet<string>;
  setlistOptions: readonly OverviewSetlistFilterOption[];
}

const SETLIST_TITLE_PREVIEW_LENGTH = 40;
const OVERVIEW_INTERNAL_LABEL_PREFIXES = [
  "branch:",
  "commit:",
  "parent:",
];

export function buildOverviewTagFilterOptions(
  beats: readonly Beat[],
): OverviewTagFilterOption[] {
  const byId = new Map<string, OverviewTagFilterOption>();

  for (const beat of beats) {
    for (const tag of overviewVisibleBeatTags(beat)) {
      const id = overviewTagFilterId(tag);
      const existing = byId.get(id);
      if (existing) {
        existing.count += 1;
      } else {
        byId.set(id, { id, label: tag, count: 1 });
      }
    }
  }

  return [...byId.values()].sort(compareTagFilterOptions);
}

export function overviewVisibleBeatTags(
  beat: Pick<Beat, "labels">,
): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const label of beat.labels) {
    const tag = cleanOverviewTag(label);
    if (!tag) continue;
    const id = overviewTagFilterId(tag);
    if (seen.has(id)) continue;
    seen.add(id);
    tags.push(tag);
  }

  return tags;
}

export function filterBeatsForOverviewFilters(
  beats: readonly Beat[],
  filters: OverviewFilterState,
): Beat[] {
  const setlistById = new Map(
    filters.setlistOptions.map((option) => [option.id, option]),
  );

  return beats.filter((beat) =>
    beatMatchesTags(beat, filters.selectedTagIds)
    && beatMatchesSetlists(
      beat,
      filters.selectedSetlistIds,
      setlistById,
    )
  );
}

export function buildOverviewSetlistFilterOptions(
  plans: readonly PlanSummary[],
  repoPath?: string,
): OverviewSetlistFilterOption[] {
  return plans
    .map((plan) => toSetlistFilterOption(plan, repoPath))
    .sort(compareSetlistFilterOptions);
}

export function formatOverviewSetlistFilterLabel(
  plan: PlanSummary,
): string {
  const title = overviewSetlistTitle(plan)
    .slice(0, SETLIST_TITLE_PREVIEW_LENGTH);
  return title ? `${plan.artifact.id} ${title}` : plan.artifact.id;
}

export function overviewSetlistFilterId(
  planId: string,
  repoPath?: string,
): string {
  return repoPath ? `${repoPath}:${planId}` : planId;
}

export function beatRepoPath(beat: Beat): string | undefined {
  const record = beat as Beat & { _repoPath?: unknown };
  return typeof record._repoPath === "string"
    && record._repoPath.trim().length > 0
    ? record._repoPath.trim()
    : undefined;
}

export function overviewTagFilterId(tag: string): string {
  return tag.trim().toLowerCase();
}

function cleanOverviewTag(label: string): string | null {
  const tag = label.trim();
  if (!tag) return null;
  if (isInternalLabel(tag)) return null;
  const normalized = tag.toLowerCase();
  if (
    OVERVIEW_INTERNAL_LABEL_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix)
    )
  ) {
    return null;
  }
  return tag;
}

function beatMatchesTags(
  beat: Beat,
  selectedTagIds: ReadonlySet<string>,
): boolean {
  if (selectedTagIds.size === 0) return true;
  return overviewVisibleBeatTags(beat).some((tag) =>
    selectedTagIds.has(overviewTagFilterId(tag))
  );
}

function beatMatchesSetlists(
  beat: Beat,
  selectedSetlistIds: ReadonlySet<string>,
  setlistById: ReadonlyMap<string, OverviewSetlistFilterOption>,
): boolean {
  if (selectedSetlistIds.size === 0) return true;
  const beatIds = beatIdentitySet(beat);
  const repoPath = beatRepoPath(beat);

  for (const selectedId of selectedSetlistIds) {
    const option = setlistById.get(selectedId);
    if (!option) continue;
    if (option.repoPath && repoPath && option.repoPath !== repoPath) {
      continue;
    }
    if (option.beatIds.some((beatId) => beatIds.has(beatId))) {
      return true;
    }
  }

  return false;
}

function toSetlistFilterOption(
  plan: PlanSummary,
  repoPath?: string,
): OverviewSetlistFilterOption {
  return {
    id: overviewSetlistFilterId(plan.artifact.id, repoPath),
    planId: plan.artifact.id,
    repoPath,
    title: overviewSetlistTitle(plan),
    label: formatOverviewSetlistFilterLabel(plan),
    beatIds: uniqueStrings(plan.plan.beatIds),
  };
}

function overviewSetlistTitle(plan: PlanSummary): string {
  return firstNonEmpty([
    plan.plan.objective,
    plan.plan.summary,
  ]) ?? "";
}

function beatIdentitySet(beat: Beat): Set<string> {
  return new Set([
    beat.id,
    ...(beat.aliases ?? []),
  ].filter((value) => value.trim().length > 0));
}

function uniqueStrings(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function firstNonEmpty(
  values: Array<string | undefined>,
): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function compareTagFilterOptions(
  left: OverviewTagFilterOption,
  right: OverviewTagFilterOption,
): number {
  return right.count - left.count
    || left.label.localeCompare(right.label);
}

function compareSetlistFilterOptions(
  left: OverviewSetlistFilterOption,
  right: OverviewSetlistFilterOption,
): number {
  return left.label.localeCompare(right.label)
    || left.id.localeCompare(right.id);
}
