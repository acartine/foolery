/**
 * Applies a breakdown plan by creating waves and beats in the backend.
 *
 * Extracted from breakdown-manager.ts to respect the 500-line file limit.
 */

import { getBackend } from "@/lib/backend-instance";
import type { CreateBeatInput } from "@/lib/backend-port";
import type {
  ApplyBreakdownResult,
  BeatPriority,
  BreakdownPlan,
  BreakdownWave,
} from "@/lib/types";
import {
  ORCHESTRATION_WAVE_LABEL,
  allocateWaveSlug,
  buildWaveSlugLabel,
  buildWaveTitle,
  extractWaveSlug,
  isLegacyNumericWaveSlug,
} from "@/lib/wave-slugs";

export async function applyBreakdownPlan(
  plan: BreakdownPlan,
  parentBeatId: string,
  repoPath: string,
): Promise<ApplyBreakdownResult> {
  const createdBeatIds: string[] = [];

  const existing = await getBackend().list(undefined, repoPath);
  if (!existing.ok || !existing.data) {
    throw new Error(
      existing.error?.message ?? "Failed to load existing beats",
    );
  }
  const usedWaveSlugs = new Set<string>();
  for (const beat of existing.data) {
    if (!beat.labels?.includes(ORCHESTRATION_WAVE_LABEL)) continue;
    const slug = extractWaveSlug(beat.labels);
    if (slug && !isLegacyNumericWaveSlug(slug)) {
      usedWaveSlugs.add(slug);
    }
  }

  let previousWaveId: string | null = null;
  const sortedWaves = plan.waves
    .slice()
    .sort((a, b) => a.waveIndex - b.waveIndex);

  for (const wave of sortedWaves) {
    if (wave.beats.length === 0) continue;

    const waveId = await createWave(
      wave, parentBeatId, usedWaveSlugs, repoPath,
    );
    createdBeatIds.push(waveId);

    if (previousWaveId) {
      const depResult = await getBackend().addDependency(
        previousWaveId, waveId, repoPath,
      );
      if (!depResult.ok) {
        throw new Error(
          depResult.error?.message ??
          `Failed to link scenes ${previousWaveId} -> ${waveId}`,
        );
      }
    }
    previousWaveId = waveId;

    for (const spec of wave.beats) {
      const beatResult = await getBackend().create(
        {
          title: spec.title,
          type: spec.type,
          priority: spec.priority,
          description: spec.description,
          parent: waveId,
        } as CreateBeatInput,
        repoPath,
      );

      if (!beatResult.ok || !beatResult.data?.id) {
        throw new Error(
          beatResult.error?.message ??
          `Failed to create beat: ${spec.title}`,
        );
      }

      createdBeatIds.push(beatResult.data.id);
    }
  }

  return {
    createdBeatIds,
    waveCount: plan.waves.length,
  };
}

async function createWave(
  wave: BreakdownWave,
  parentBeatId: string,
  usedWaveSlugs: Set<string>,
  repoPath: string,
): Promise<string> {
  const minPriority = Math.min(
    ...wave.beats.map((b) => b.priority),
  ) as BeatPriority;

  const waveSlug = allocateWaveSlug(usedWaveSlugs);
  const waveTitle = buildWaveTitle(waveSlug, wave.name);

  const description = [
    `Objective: ${wave.objective}`,
    wave.notes ? `\nNotes: ${wave.notes}` : null,
    `\nAssigned tasks:`,
    ...wave.beats.map((b) => `- ${b.title}`),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const waveResult = await getBackend().create(
    {
      title: waveTitle,
      type: "epic",
      priority: minPriority,
      labels: [
        ORCHESTRATION_WAVE_LABEL,
        buildWaveSlugLabel(waveSlug),
      ],
      description,
      parent: parentBeatId,
    } as CreateBeatInput,
    repoPath,
  );

  if (!waveResult.ok || !waveResult.data?.id) {
    throw new Error(
      waveResult.error?.message ??
      `Failed to create scene ${wave.waveIndex}`,
    );
  }

  return waveResult.data.id;
}
