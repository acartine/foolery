import type {
  PlanDocument,
  PlanSummary,
} from "@/lib/orchestration-plan-types";
import type { Beat } from "@/lib/types";

export interface SetlistPreviewBeat {
  id: string;
  label: string;
  title?: string;
}

export interface SetlistPlanPreview {
  id: string;
  summary: string;
  objective?: string;
  totalBeats: number;
  previewBeats: SetlistPreviewBeat[];
  remainingBeats: number;
}

export interface SetlistChartSlot {
  id: string;
  waveLabel: string;
  detail: string;
}

export interface SetlistChartItem {
  beatId: string;
  detailBeatId: string;
  beatLabel: string;
  title: string;
  description?: string;
  state?: string;
  type?: string;
  notes?: string;
  isActiveLease: boolean;
  span: number;
}

export interface SetlistChartRow {
  beatId: string;
  rankLabel: string;
  order: number;
  beatLabel: string;
  title: string;
  description?: string;
  state?: string;
  type?: string;
  label: string;
  cells: Array<SetlistChartItem | null>;
}

export interface SetlistChartModel {
  slots: SetlistChartSlot[];
  rows: SetlistChartRow[];
}

export interface SetlistChartWindow {
  slotStart: number;
  slotEnd: number;
  slots: SetlistChartSlot[];
  rows: SetlistChartRow[];
}

export interface SetlistChartViewport {
  initialSlotStart: number;
  maxSlotStart: number;
  pageSize: number;
}

export const SETLIST_CHART_PAGE_SIZE = 12;

const TERMINAL_SETLIST_STATES = new Set([
  "shipped",
  "abandoned",
  "closed",
]);

const TERMINAL_PLAN_ARTIFACT_STATES = new Set([
  "shipped",
  "abandoned",
]);

interface SlotAssignment {
  slotIndex: number;
  order: number;
  notes?: string;
  span: number;
}

interface ScheduledSegment {
  beatIds: string[];
  waveLabel: string;
  detail: string;
  notes?: string;
}

export function buildSetlistPlanPreview(
  summary: PlanSummary,
  beatMap: ReadonlyMap<string, Beat>,
): SetlistPlanPreview {
  const beatIds = uniqueBeatIds(summary.plan.beatIds);
  const previewBeats = beatIds
    .slice(0, 3)
    .map((beatId) => toPreviewBeat(beatId, beatMap))
    .filter((beat): beat is SetlistPreviewBeat => Boolean(beat));

  return {
    id: summary.artifact.id,
    summary: summary.plan.summary,
    objective: summary.plan.objective,
    totalBeats: beatIds.length,
    previewBeats,
    remainingBeats: Math.max(beatIds.length - previewBeats.length, 0),
  };
}

export function buildSetlistChart(
  plan: PlanDocument,
  beatMap: ReadonlyMap<string, Beat>,
  options?: {
    activeBeatIds?: ReadonlySet<string>;
  },
): SetlistChartModel {
  const {
    slots,
    slotByBeatId,
  } = buildScheduledSlots(plan);
  const activeBeatIds = options?.activeBeatIds ?? new Set<string>();
  const rows = uniqueBeatIds(plan.beatIds)
    .filter((beatId) => slotByBeatId.has(beatId))
    .map((beatId) =>
      buildRow(
        beatId,
        beatMap,
        slotByBeatId,
        activeBeatIds,
        slots.length,
      ))
    .sort((left, right) =>
      left.order - right.order ||
      left.title.localeCompare(right.title) ||
      left.beatId.localeCompare(right.beatId),
    )
    .map((row, index, allRows) => ({
      ...row,
      rankLabel: toRankLabel(index, allRows.length),
      label: `${index + 1}`,
    }));

  return { slots, rows };
}

export function isTerminalSetlistState(
  state: string | undefined,
): boolean {
  if (!state) return false;
  return TERMINAL_SETLIST_STATES.has(state);
}

export function countWorkableSetlistRows(
  chart: SetlistChartModel,
): number {
  return chart.rows.filter(
    (row) => !isTerminalSetlistState(row.state),
  ).length;
}

export function isTerminalPlanArtifactState(
  state: string | undefined,
): boolean {
  if (!state) return false;
  return TERMINAL_PLAN_ARTIFACT_STATES.has(state);
}

export function countWorkableBeatIds(
  beatIds: readonly string[],
  beatMap: ReadonlyMap<string, Beat>,
): number {
  const seen = new Set<string>();
  let count = 0;
  for (const beatId of beatIds) {
    if (!beatId || seen.has(beatId)) continue;
    seen.add(beatId);
    const beat = beatMap.get(beatId);
    if (isTerminalSetlistState(beat?.state)) continue;
    count += 1;
  }
  return count;
}

export function buildSetlistChartViewport(
  chart: SetlistChartModel,
  pageSize = SETLIST_CHART_PAGE_SIZE,
): SetlistChartViewport {
  const normalizedPageSize = Math.max(pageSize, 1);
  const maxSlotStart = Math.max(
    chart.slots.length - normalizedPageSize,
    0,
  );
  const initialSlotIndex =
    findFirstIncompleteSetlistSlotIndex(chart);

  return {
    initialSlotStart: clampSetlistSlotStart(
      initialSlotIndex >= 0
        ? initialSlotIndex
        : maxSlotStart,
      maxSlotStart,
    ),
    maxSlotStart,
    pageSize: normalizedPageSize,
  };
}

function buildRow(
  beatId: string,
  beatMap: ReadonlyMap<string, Beat>,
  slotByBeatId: ReadonlyMap<string, SlotAssignment>,
  activeBeatIds: ReadonlySet<string>,
  slotCount: number,
): SetlistChartRow {
  const beat = beatMap.get(beatId);
  const detailBeatId = beat?.id ?? beatId;
  const assignment = slotByBeatId.get(beatId);
  const slotIndex = assignment?.slotIndex ?? 0;
  const isActiveLease =
    activeBeatIds.has(beatId)
    || activeBeatIds.has(detailBeatId);
  const cells = Array.from(
    { length: slotCount },
    () => null as SetlistChartItem | null,
  );

  cells[slotIndex] = {
    beatId,
    detailBeatId,
    beatLabel: detailBeatId,
    title: beat?.title ?? detailBeatId,
    description: normalizeDescription(beat?.description),
    state: beat?.state,
    type: beat?.type,
    notes: assignment?.notes,
    isActiveLease,
    span: assignment?.span ?? 1,
  };

  return {
    beatId,
    rankLabel: "",
    order: assignment?.order ?? Number.MAX_SAFE_INTEGER,
    beatLabel: detailBeatId,
    title: beat?.title ?? detailBeatId,
    description: normalizeDescription(beat?.description),
    state: beat?.state,
    type: beat?.type,
    label: "",
    cells,
  };
}

function uniqueBeatIds(beatIds: string[]): string[] {
  return Array.from(
    new Set(
      beatIds.filter((beatId) => beatId.trim().length > 0),
    ),
  );
}

export function sliceSetlistChart(
  chart: SetlistChartModel,
  slotStart: number,
  pageSize: number,
): SetlistChartWindow {
  const maxSlotStart = Math.max(
    chart.slots.length - Math.max(pageSize, 1),
    0,
  );
  const boundedSlotStart = clampSetlistSlotStart(
    slotStart,
    maxSlotStart,
  );
  const slotEnd = Math.min(
    boundedSlotStart + Math.max(pageSize, 1),
    chart.slots.length,
  );
  const slots = chart.slots.slice(boundedSlotStart, slotEnd);
  const rows = chart.rows
    .map((row) => ({
      ...row,
      cells: row.cells.slice(boundedSlotStart, slotEnd),
    }))
    .filter((row) => row.cells.some((cell) => cell !== null));

  return {
    slotStart: boundedSlotStart,
    slotEnd,
    slots,
    rows,
  };
}

function findFirstIncompleteSetlistSlotIndex(
  chart: SetlistChartModel,
): number {
  for (let slotIndex = 0; slotIndex < chart.slots.length; slotIndex += 1) {
    for (const row of chart.rows) {
      const cell = row.cells[slotIndex];
      if (cell && !isTerminalSetlistState(cell.state)) {
        return slotIndex;
      }
    }
  }
  return -1;
}

function clampSetlistSlotStart(
  slotStart: number,
  maxSlotStart: number,
): number {
  return Math.max(Math.min(slotStart, maxSlotStart), 0);
}

function toPreviewBeat(
  beatId: string,
  beatMap: ReadonlyMap<string, Beat>,
): SetlistPreviewBeat | null {
  const beat = beatMap.get(beatId);
  const displayId = beat?.id ?? beatId;
  if (!beat) {
    return {
      id: displayId,
      label: displayId,
    };
  }

  return {
    id: displayId,
    label: displayId,
    title: beat.title,
  };
}

function normalizeDescription(
  description: string | undefined,
): string | undefined {
  return description?.trim() ? description.trim() : undefined;
}

function buildScheduledSlots(
  plan: PlanDocument,
): {
  slots: SetlistChartSlot[];
  slotByBeatId: Map<string, SlotAssignment>;
} {
  const segments = collectScheduledSegments(plan);
  const slotByBeatId = new Map<string, SlotAssignment>();
  const slots: SetlistChartSlot[] = [];
  let slotIndex = 0;
  let order = 0;

  for (const segment of segments) {
    slots.push({
      id: `${segment.waveLabel}-${slotIndex}`,
      waveLabel: segment.waveLabel,
      detail: segment.detail,
    });

    for (const beatId of segment.beatIds) {
      slotByBeatId.set(beatId, {
        slotIndex,
        order,
        notes: segment.notes,
        span: 1,
      });
      order += 1;
    }

    slotIndex += 1;
  }

  return {
    slots: slots.length > 0
      ? slots
      : [
          {
            id: "unscheduled-0",
            waveLabel: "Wave 1",
            detail: "Execution slot",
          },
        ],
    slotByBeatId,
  };
}

function collectScheduledSegments(
  plan: PlanDocument,
): ScheduledSegment[] {
  const scheduled: ScheduledSegment[] = [];
  const seenBeatIds = new Set<string>();

  for (const wave of [...plan.waves].sort((left, right) =>
    left.waveIndex - right.waveIndex,
  )) {
    const waveLabel = `Wave ${wave.waveIndex}`;

    for (const step of [...wave.steps].sort((left, right) =>
      left.stepIndex - right.stepIndex,
    )) {
      const stepBeatIds = step.beatIds.filter((beatId) => {
        if (seenBeatIds.has(beatId)) {
          return false;
        }
        seenBeatIds.add(beatId);
        return true;
      });

      if (stepBeatIds.length > 0) {
        scheduled.push({
          beatIds: stepBeatIds,
          waveLabel,
          detail: wave.name,
          notes: normalizeDescription(step.notes),
        });
      }
    }

    for (const beat of wave.beats) {
      if (seenBeatIds.has(beat.id)) {
        continue;
      }
      scheduled.push({
        beatIds: [beat.id],
        waveLabel,
        detail: wave.name,
      });
      seenBeatIds.add(beat.id);
    }
  }

  return scheduled;
}

function toRankLabel(
  index: number,
  total: number,
): string {
  if (index === 0) return "Next";
  if (index === total - 1) return "Last";
  return `#${index + 1}`;
}
