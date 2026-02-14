import { NextRequest, NextResponse } from "next/server";
import { createRestagedOrchestrationSession } from "@/lib/orchestration-manager";
import type {
  OrchestrationAgentSpec,
  OrchestrationPlan,
  OrchestrationWave,
} from "@/lib/types";

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseAgents(value: unknown): OrchestrationAgentSpec[] {
  if (!Array.isArray(value)) return [];
  const agents: OrchestrationAgentSpec[] = [];

  for (const item of value) {
    const obj = toObject(item);
    if (!obj) continue;

    const role = parseText(obj.role);
    if (!role) continue;
    const countValue = Number(obj.count);
    const count = Number.isFinite(countValue)
      ? Math.max(1, Math.trunc(countValue))
      : 1;
    const specialty = parseText(obj.specialty);

    agents.push({ role, count, specialty });
  }

  return agents;
}

function parseWave(
  value: unknown,
  fallbackWaveIndex: number
): OrchestrationWave | null {
  const obj = toObject(value);
  if (!obj) return null;

  const waveIndexValue = Number(
    obj.waveIndex ?? obj.wave_index ?? fallbackWaveIndex
  );
  const waveIndex = Number.isFinite(waveIndexValue)
    ? Math.max(1, Math.trunc(waveIndexValue))
    : fallbackWaveIndex;
  const name = parseText(obj.name) ?? `Wave ${waveIndex}`;
  const objective =
    parseText(obj.objective) ?? "Execute assigned beats for this wave.";
  const notes = parseText(obj.notes);
  const agents = parseAgents(obj.agents);
  const beadObjects = Array.isArray(obj.beads) ? obj.beads : [];
  const beads = beadObjects
    .map((beadValue) => {
      const beadObj = toObject(beadValue);
      if (!beadObj) return null;
      const id = parseText(beadObj.id);
      if (!id) return null;
      return {
        id,
        title: parseText(beadObj.title) ?? id,
      };
    })
    .filter((bead): bead is { id: string; title: string } => Boolean(bead));

  if (beads.length === 0) return null;

  return {
    waveIndex,
    name,
    objective,
    agents,
    beads,
    notes,
  };
}

function parsePlan(value: unknown): OrchestrationPlan | null {
  const obj = toObject(value);
  if (!obj) return null;

  const rawWaves = Array.isArray(obj.waves) ? obj.waves : [];
  const waves = rawWaves
    .map((wave, index) => parseWave(wave, index + 1))
    .filter((wave): wave is OrchestrationWave => Boolean(wave))
    .sort((a, b) => a.waveIndex - b.waveIndex);

  if (waves.length === 0) return null;

  return {
    summary:
      parseText(obj.summary) ??
      `Restaged ${waves.length} wave${waves.length === 1 ? "" : "s"}.`,
    waves,
    assumptions: parseStringArray(obj.assumptions),
    unassignedBeadIds: parseStringArray(
      obj.unassignedBeadIds ?? obj.unassigned_bead_ids
    ),
  };
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const repoPath =
    typeof body?._repo === "string" && body._repo.trim()
      ? body._repo.trim()
      : "";
  const objective =
    typeof body?.objective === "string" && body.objective.trim()
      ? body.objective.trim()
      : undefined;
  const plan = parsePlan(body?.plan);

  if (!repoPath) {
    return NextResponse.json(
      { error: "_repo is required" },
      { status: 400 }
    );
  }

  if (!plan) {
    return NextResponse.json(
      { error: "plan with at least one wave is required" },
      { status: 400 }
    );
  }

  try {
    const session = await createRestagedOrchestrationSession(
      repoPath,
      plan,
      objective
    );
    return NextResponse.json({ data: session }, { status: 201 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to restage orchestration";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
