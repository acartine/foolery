import { EventEmitter } from "node:events";

import { noopInteractionLog } from "@/lib/interaction-logger";
import {
  type OrchestrationSessionEntry,
  collectEligibleBeats,
  finalizeSession,
  generateId,
  sessions,
} from "@/lib/orchestration-internals";
import type { Beat, OrchestrationPlan, OrchestrationSession } from "@/lib/types";

function normalizeRestagePlan(
  plan: OrchestrationPlan,
  allBeats: Map<string, Beat>,
): OrchestrationPlan {
  const assigned = new Set<string>();

  const normalizedWaves = plan.waves
    .slice()
    .sort((a, b) => a.waveIndex - b.waveIndex)
    .map((wave, index) => {
      const fallbackWaveIndex = index + 1;
      const waveIndex = Number.isFinite(wave.waveIndex)
        ? Math.max(1, Math.trunc(wave.waveIndex))
        : fallbackWaveIndex;
      const name = wave.name?.trim() || `Scene ${waveIndex}`;
      const waveObjective =
        wave.objective?.trim() || "Execute assigned beats for this scene.";
      const notes = wave.notes?.trim() || undefined;
      const agents = wave.agents
        .filter((agent) => Boolean(agent.role?.trim()))
        .map((agent) => ({
          role: agent.role.trim(),
          count: Math.max(1, Math.trunc(agent.count || 1)),
          specialty: agent.specialty?.trim() || undefined,
        }));

      const beatsForWave = wave.beats
        .filter(
          (beat) =>
            typeof beat.id === "string" &&
            beat.id.trim().length > 0,
        )
        .map((beat) => beat.id.trim())
        .filter(
          (beatId) =>
            allBeats.has(beatId) && !assigned.has(beatId),
        )
        .map((beatId) => {
          assigned.add(beatId);
          return {
            id: beatId,
            title: allBeats.get(beatId)?.title ?? beatId,
          };
        });

      return {
        waveIndex,
        name,
        objective: waveObjective,
        agents,
        beats: beatsForWave,
        notes,
      };
    })
    .filter((wave) => wave.beats.length > 0);

  if (normalizedWaves.length === 0) {
    throw new Error(
      "Restaged plan has no beats currently eligible " +
        "(open/in_progress/blocked).",
    );
  }

  return {
    summary:
      plan.summary?.trim() ||
      `Restaged ${normalizedWaves.length} scene${
        normalizedWaves.length === 1 ? "" : "s"
      }.`,
    waves: normalizedWaves,
    unassignedBeatIds: (plan.unassignedBeatIds ?? []).filter(
      (id) =>
        typeof id === "string" &&
        allBeats.has(id) &&
        !assigned.has(id),
    ),
    assumptions: (plan.assumptions ?? [])
      .filter(
        (assumption): assumption is string =>
          typeof assumption === "string",
      )
      .map((assumption) => assumption.trim())
      .filter((assumption) => assumption.length > 0),
  };
}

export async function createRestagedOrchestrationSession(
  repoPath: string,
  plan: OrchestrationPlan,
  objective?: string,
): Promise<OrchestrationSession> {
  const beats = await collectEligibleBeats(repoPath);

  if (beats.length === 0) {
    throw new Error(
      "No open/in_progress/blocked beats available " +
        "for orchestration",
    );
  }

  const allBeats = new Map(
    beats.map((beat) => [beat.id, beat]),
  );
  const normalizedPlan = normalizeRestagePlan(
    plan,
    allBeats,
  );

  const session: OrchestrationSession = {
    id: generateId(),
    repoPath,
    status: "running",
    startedAt: new Date().toISOString(),
    objective: objective?.trim() || undefined,
    plan: normalizedPlan,
  };

  const entry: OrchestrationSessionEntry = {
    session,
    process: null,
    emitter: new EventEmitter(),
    buffer: [],
    allBeats,
    draftWaves: new Map(
      normalizedPlan.waves.map((wave) => [
        wave.waveIndex,
        wave,
      ]),
    ),
    assistantText: "",
    lineBuffer: "",
    exited: false,
    interactionLog: noopInteractionLog(),
  };
  entry.emitter.setMaxListeners(20);
  sessions.set(session.id, entry);

  finalizeSession(
    entry,
    "completed",
    "Restaged existing groups into Scene view",
  );
  return session;
}
