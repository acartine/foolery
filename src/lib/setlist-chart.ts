import { displayBeatLabel } from "@/lib/beat-display";
import type {
  PlanDocument,
  PlanSummary,
} from "@/lib/orchestration-plan-types";
import type { Beat, BeatPriority } from "@/lib/types";

export interface SetlistPreviewBeat {
  id: string;
  label: string;
  title: string;
  description?: string;
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
  label: string;
  waveLabel: string;
  detail: string;
}

export interface SetlistChartItem {
  beatId: string;
  beatLabel: string;
  title: string;
  description?: string;
  state?: string;
  type?: string;
}

export interface SetlistChartLane {
  priority: BeatPriority;
  label: string;
  itemsCount: number;
  cells: SetlistChartItem[][];
}

export interface SetlistChartModel {
  slots: SetlistChartSlot[];
  lanes: SetlistChartLane[];
}

const EXECUTION_PRIORITY_LABELS: Record<BeatPriority, string> = {
  0: "Next",
  1: "Soon",
  2: "Queued",
  3: "Later",
  4: "Last",
};
const EXECUTION_PRIORITY_ORDER: BeatPriority[] = [0, 1, 2, 3, 4];

interface PlanBeatMeta {
  title: string;
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
  const slots = buildSlots(plan);
  const beatMeta = buildPlanBeatMeta(plan);
  const slotByBeatId = assignBeatSlots(plan, slots);
  const laneCells = createLaneCells(slots.length);

  for (const beatId of uniqueBeatIds(plan.beatIds)) {
    const slotIndex = slotByBeatId.get(beatId) ?? 0;
    const beat = beatMap.get(beatId);
    const priority = beat?.priority ?? 2;
    laneCells[priority][slotIndex]!.push({
      beatId,
      beatLabel: displayBeatLabel(beatId, beat?.aliases),
      title: beat?.title ?? beatMeta.get(beatId)?.title ?? beatId,
      description: normalizeDescription(beat?.description),
      state: beat?.state,
      type: beat?.type,
    });
  }

  return {
    slots,
    lanes: EXECUTION_PRIORITY_ORDER.map((priority) => {
      const cells = laneCells[priority].map((cell) =>
        [...cell].sort(compareChartItems),
      );
      return {
        priority,
        label: EXECUTION_PRIORITY_LABELS[priority],
        itemsCount: cells.reduce(
          (total, cell) => total + cell.length,
          0,
        ),
        cells,
      };
    }),
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
  if (!beat) {
    return {
      id: beatId,
      label: beatId,
      title: beatId,
    };
  }

  return {
    id: beatId,
    label: displayBeatLabel(beat.id, beat.aliases),
    title: beat.title,
    description: normalizeDescription(beat.description),
  };
}

function normalizeDescription(
  description: string | undefined,
): string | undefined {
  return description?.trim() ? description.trim() : undefined;
}

function buildSlots(plan: PlanDocument): SetlistChartSlot[] {
  const slots = plan.waves.flatMap((wave) => {
    const waveLabel = `Wave ${wave.waveIndex}`;
    return [...wave.steps]
      .sort((left, right) => left.stepIndex - right.stepIndex)
      .map((step) => ({
        id: `${wave.waveIndex}-${step.stepIndex}`,
        label: `Step ${step.stepIndex}`,
        waveLabel,
        detail: wave.name,
      }));
  });

  return slots.length > 0
    ? slots
    : [
        {
          id: "1-1",
          label: "Step 1",
          waveLabel: "Wave 1",
          detail: "Execution slot",
        },
      ];
}

function buildPlanBeatMeta(
  plan: PlanDocument,
): Map<string, PlanBeatMeta> {
  const meta = new Map<string, PlanBeatMeta>();
  for (const wave of plan.waves) {
    for (const beat of wave.beats) {
      meta.set(beat.id, { title: beat.title });
    }
  }
  return meta;
}

function assignBeatSlots(
  plan: PlanDocument,
  slots: SetlistChartSlot[],
): Map<string, number> {
  const slotByBeatId = new Map<string, number>();
  let nextSlotIndex = 0;

  for (const wave of [...plan.waves].sort((left, right) =>
    left.waveIndex - right.waveIndex,
  )) {
    const waveSteps = [...wave.steps].sort((left, right) =>
      left.stepIndex - right.stepIndex,
    );
    const waveStartSlot = nextSlotIndex;

    for (const step of waveSteps) {
      const slotIndex = Math.min(nextSlotIndex, slots.length - 1);
      for (const beatId of step.beatIds) {
        if (!slotByBeatId.has(beatId)) {
          slotByBeatId.set(beatId, slotIndex);
        }
      }
      nextSlotIndex += 1;
    }

    for (const beat of wave.beats) {
      if (!slotByBeatId.has(beat.id)) {
        slotByBeatId.set(beat.id, waveStartSlot);
      }
    }
  }

  for (const beatId of uniqueBeatIds(plan.beatIds)) {
    if (!slotByBeatId.has(beatId)) {
      slotByBeatId.set(beatId, 0);
    }
  }

  return slotByBeatId;
}

function createLaneCells(
  slotCount: number,
): Record<BeatPriority, SetlistChartItem[][]> {
  const createCells = () =>
    Array.from({ length: slotCount }, () => [] as SetlistChartItem[]);

  return {
    0: createCells(),
    1: createCells(),
    2: createCells(),
    3: createCells(),
    4: createCells(),
  };
}

function compareChartItems(
  left: SetlistChartItem,
  right: SetlistChartItem,
): number {
  return left.title.localeCompare(right.title) ||
    left.beatId.localeCompare(right.beatId);
}
