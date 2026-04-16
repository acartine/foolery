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
): SetlistChartModel {
  const {
    slots,
    slotByBeatId,
  } = buildScheduledSlots(plan);
  const rows = uniqueBeatIds(plan.beatIds)
    .filter((beatId) => slotByBeatId.has(beatId))
    .map((beatId) =>
      buildRow(
        beatId,
        beatMap,
        slotByBeatId,
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

function buildRow(
  beatId: string,
  beatMap: ReadonlyMap<string, Beat>,
  slotByBeatId: ReadonlyMap<string, SlotAssignment>,
  slotCount: number,
): SetlistChartRow {
  const beat = beatMap.get(beatId);
  const detailBeatId = beat?.id ?? beatId;
  const assignment = slotByBeatId.get(beatId);
  const slotIndex = assignment?.slotIndex ?? 0;
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
