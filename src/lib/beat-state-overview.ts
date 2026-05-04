import type { Beat } from "@/lib/types";
import {
  displayBeatLabel,
  firstBeatAlias,
} from "@/lib/beat-display";
import { compareBeatsByPriorityThenUpdated } from "@/lib/beat-sort";
import { compareWorkflowStatePriority } from "@/lib/workflows";

export interface BeatStateGroup {
  state: string;
  beats: Beat[];
  required: boolean;
}

export interface OverviewLeaseInfo {
  startedAt?: string;
  provider?: string;
  model?: string;
  version?: string;
}

export const OVERVIEW_STATE_TABS = [
  { id: "work_items", label: "Work Items" },
  { id: "exploration", label: "Exploration" },
  { id: "gates", label: "Gates" },
  { id: "terminated", label: "Terminated" },
] as const;

export type OverviewStateTabId =
  (typeof OVERVIEW_STATE_TABS)[number]["id"];

export interface OverviewStateTabSummary {
  id: OverviewStateTabId;
  label: string;
  count: number;
}

export const DEFAULT_OVERVIEW_STATE_TAB: OverviewStateTabId =
  "work_items";

const WORK_ITEM_OVERVIEW_STATES = [
  "ready_for_planning",
  "planning",
  "ready_for_plan_review",
  "plan_review",
  "ready_for_implementation",
  "implementation",
  "ready_for_implementation_review",
  "implementation_review",
  "ready_for_shipment",
  "shipment",
  "ready_for_shipment_review",
  "shipment_review",
] as const;

const OVERVIEW_TAB_REQUIRED_STATES: Record<
  OverviewStateTabId,
  readonly string[]
> = {
  work_items: WORK_ITEM_OVERVIEW_STATES,
  exploration: ["ready_for_exploration"],
  gates: ["ready_to_evaluate"],
  terminated: ["abandoned", "deferred", "shipped"],
};

const OVERVIEW_STATE_TAB_OVERRIDES = new Map<string, OverviewStateTabId>([
  ["ready_for_exploration", "exploration"],
  ["ready_to_evaluate", "gates"],
  ["abandoned", "terminated"],
  ["deferred", "terminated"],
  ["shipped", "terminated"],
]);

const ACTIVE_OVERVIEW_STATES = new Set<string>([
  "planning",
  "plan_review",
  "implementation",
  "implementation_review",
  "shipment",
  "shipment_review",
]);

export function normalizeOverviewState(
  state: string | null | undefined,
): string {
  const normalized = state?.trim().toLowerCase();
  return normalized && normalized.length > 0
    ? normalized
    : "unknown";
}

export function groupBeatsByState(
  beats: readonly Beat[],
): BeatStateGroup[] {
  const byState = new Map<string, Beat[]>();

  for (const beat of beats) {
    const state = normalizeOverviewState(beat.state);
    const group = byState.get(state) ?? [];
    group.push(beat);
    byState.set(state, group);
  }

  return [...byState.entries()]
    .sort(([left], [right]) =>
      compareWorkflowStatePriority(left, right)
    )
    .map(([state, group]) => ({
      state,
      required: false,
      beats: [...group].sort(compareBeatsByPriorityThenUpdated),
    }));
}

export function groupOverviewBeatsByState(
  beats: readonly Beat[],
  tabId: OverviewStateTabId = DEFAULT_OVERVIEW_STATE_TAB,
): BeatStateGroup[] {
  const tabBeats = beats.filter((beat) =>
    overviewTabForState(beat.state) === tabId
  );
  const groups = new Map(
    groupBeatsByState(tabBeats).map((group) => [
      group.state,
      group,
    ]),
  );

  for (const state of OVERVIEW_TAB_REQUIRED_STATES[tabId]) {
    const existing = groups.get(state);
    groups.set(state, {
      state,
      required: true,
      beats: existing?.beats ?? [],
    });
  }

  return [...groups.values()].sort((left, right) =>
    compareOverviewStatePriority(tabId, left.state, right.state)
  );
}

export function isOverviewBeat(beat: Beat): boolean {
  return beat.type.trim().toLowerCase() !== "lease";
}

export function filterOverviewBeats(
  beats: readonly Beat[],
): Beat[] {
  return beats.filter(isOverviewBeat);
}

export function overviewTabForState(
  state: string | null | undefined,
): OverviewStateTabId {
  return OVERVIEW_STATE_TAB_OVERRIDES.get(
    normalizeOverviewState(state),
  ) ?? DEFAULT_OVERVIEW_STATE_TAB;
}

export function buildOverviewStateTabs(
  beats: readonly Beat[],
): OverviewStateTabSummary[] {
  const counts: Record<OverviewStateTabId, number> = {
    work_items: 0,
    exploration: 0,
    gates: 0,
    terminated: 0,
  };

  for (const beat of beats) {
    if (!isOverviewBeat(beat)) continue;
    counts[overviewTabForState(beat.state)] += 1;
  }

  return OVERVIEW_STATE_TABS.map((tab) => ({
    ...tab,
    count: counts[tab.id],
  }));
}

export function isOverviewActiveState(
  state: string | null | undefined,
): boolean {
  return ACTIVE_OVERVIEW_STATES.has(normalizeOverviewState(state));
}

export function overviewBeatLabel(
  beat: Pick<Beat, "id" | "aliases">,
  isAllRepositories: boolean,
): string {
  if (!isAllRepositories) {
    return displayBeatLabel(beat.id, beat.aliases);
  }
  return firstBeatAlias(beat.aliases) ?? beat.id;
}

export function overviewLeaseInfoForBeat(
  beat: Beat,
  terminalInfo?: OverviewLeaseInfo,
): OverviewLeaseInfo | null {
  if (!isOverviewActiveState(beat.state)) return null;
  const info = {
    startedAt:
      cleanString(terminalInfo?.startedAt)
      ?? activeStepStartedAt(beat),
    provider:
      cleanString(terminalInfo?.provider)
      ?? leaseAgentInfoString(beat, "provider"),
    model:
      cleanString(terminalInfo?.model)
      ?? leaseAgentInfoString(beat, "model"),
    version:
      cleanString(terminalInfo?.version)
      ?? leaseAgentInfoString(beat, "model_version"),
  };
  return Object.values(info).some(Boolean) ? info : null;
}

export function countGroupedBeats(
  groups: readonly BeatStateGroup[],
): number {
  return groups.reduce(
    (total, group) => total + group.beats.length,
    0,
  );
}

function activeStepStartedAt(beat: Beat): string | undefined {
  const steps = beat.metadata?.knotsSteps;
  if (!Array.isArray(steps)) return undefined;
  const state = normalizeOverviewState(beat.state);

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (!step || typeof step !== "object") continue;
    const record = step as Record<string, unknown>;
    if (record.step !== state) continue;
    const startedAt = cleanString(record.started_at);
    if (startedAt) return startedAt;
  }

  return undefined;
}

function leaseAgentInfoString(
  beat: Beat,
  key: string,
): string | undefined {
  const info = beat.metadata?.knotsLeaseAgentInfo;
  if (!info || typeof info !== "object") return undefined;
  return cleanString((info as Record<string, unknown>)[key]);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function compareOverviewStatePriority(
  tabId: OverviewStateTabId,
  left: string,
  right: string,
): number {
  const required = OVERVIEW_TAB_REQUIRED_STATES[tabId];
  const leftIndex = required.indexOf(left);
  const rightIndex = required.indexOf(right);

  if (leftIndex !== -1 && rightIndex !== -1) {
    return leftIndex - rightIndex;
  }
  if (leftIndex !== -1) return -1;
  if (rightIndex !== -1) return 1;
  return compareWorkflowStatePriority(left, right);
}
