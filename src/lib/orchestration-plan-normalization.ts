import type {
  Beat,
  OrchestrationAgentSpec,
  OrchestrationPlan,
  OrchestrationWave,
  OrchestrationWaveStep,
} from "@/lib/types";

import {
  type JsonObject,
  type PromptDependencyEdge,
  type PromptScopeBeat,
  ORCHESTRATION_JSON_TAG,
  toInt,
  toObject,
} from "@/lib/orchestration-internals";

export function extractObjectiveBeatIds(
  objective?: string,
): string[] {
  if (!objective?.trim()) return [];

  const beatIdPattern = /\b[a-z0-9]+-[a-z0-9]+(?:\.[0-9]+)*\b/gi;
  const matches = objective.match(beatIdPattern) ?? [];
  return Array.from(
    new Set(matches.map((match) => match.trim().toLowerCase())),
  );
}

export function derivePromptScope(
  beats: Beat[],
  objective?: string,
): {
  scopedBeats: PromptScopeBeat[];
  unresolvedScopeIds: string[];
} {
  const normalizedToOriginal = new Map<string, string>();
  const beatById = new Map<string, Beat>();

  for (const beat of beats) {
    const normalized = beat.id.toLowerCase();
    normalizedToOriginal.set(normalized, beat.id);
    beatById.set(normalized, beat);
  }

  const objectiveIds = extractObjectiveBeatIds(objective);
  const scopedBeats: PromptScopeBeat[] = [];
  const unresolvedScopeIds: string[] = [];

  for (const id of objectiveIds) {
    const beat = beatById.get(id);
    if (!beat) {
      unresolvedScopeIds.push(normalizedToOriginal.get(id) ?? id);
      continue;
    }

    scopedBeats.push({
      id: beat.id,
      title: beat.title,
      type: beat.type,
      state: beat.state,
      priority: beat.priority,
      description: beat.description,
    });
  }

  scopedBeats.sort((a, b) => a.id.localeCompare(b.id));
  unresolvedScopeIds.sort((a, b) => a.localeCompare(b));
  return { scopedBeats, unresolvedScopeIds };
}

export function buildPrompt(
  repoPath: string,
  scopedBeats: PromptScopeBeat[],
  unresolvedScopeIds: string[],
  edges: PromptDependencyEdge[],
  objective?: string,
  mode: "scene" | "groom" = "groom",
): string {
  const hasExplicitScope =
    scopedBeats.length > 0 || unresolvedScopeIds.length > 0;
  const isGroomMode = mode === "groom";
  return [
    "You are an orchestration planner for engineering work tracked as issues/work items.",
    "Create execution waves that respect dependencies while maximizing useful parallelism.",
    `Repository: ${repoPath}`,
    `Planning mode: ${mode}`,
    objective && objective.trim()
      ? `Planning objective: ${objective.trim()}`
      : "Planning objective: Minimize lead time while keeping waves coherent.",
    "",
    "Scope guidance:",
    hasExplicitScope
      ? "Use the explicit work-item IDs below as the in-scope planning set."
      : "No explicit beat IDs were provided. Infer scope from the objective and inspect beats as needed.",
    ...scopedBeats.flatMap((beat) => {
      const lines = [
        `- ${beat.id} [${beat.type}, ${beat.state}, P${beat.priority}]: ${beat.title}`,
      ];
      if (isGroomMode && beat.description?.trim()) {
        lines.push(`  description: ${beat.description.trim()}`);
      }
      return lines;
    }),
    ...(unresolvedScopeIds.length > 0
      ? [
          "Objective mentioned IDs not present in the loaded planning scope:",
          ...unresolvedScopeIds.map((id) => `- ${id}`),
        ]
      : []),
    "",
    "Edges:",
    ...(edges.length > 0
      ? edges.map((edge) => `- ${edge.blockerId} blocks ${edge.blockedId}`)
      : ["- No dependency edges found among the eligible beats."]),
    "",
    isGroomMode ? "Groom mode instructions:" : "Scene mode instructions:",
    ...(isGroomMode
      ? [
          "- Read the code for files or modules mentioned in beat descriptions before finalizing the plan.",
          "- Group beats that touch the same files or modules into the same step so they run sequentially.",
          "- Separate independent beats into different steps within the same wave so they can run in parallel.",
        ]
      : [
          "- Stay lightweight and metadata-first unless the objective clearly requires code inspection.",
          "- Use steps to represent independent concurrent groups inside a wave when the metadata already supports that split.",
        ]),
    "",
    "Use focused repo search and file-read commands to inspect missing context instead of guessing.",
    "Once you have enough context to place every in-scope beat, stop exploring and emit the plan.",
    "",
    "Hard rules:",
    "- Every in-scope beat ID must appear in exactly one wave or in unassigned_beat_ids.",
    "- If blocker -> blocked, blocker must be in an earlier wave than blocked when both are in-scope.",
    "- Every beat assigned to a wave must appear in exactly one step within that wave.",
    "- For each wave, propose agent roles and count. Specialty is optional but useful.",
    "- Keep wave names short and concrete.",
    "- Do not hide execution structure only in notes: emit separate waves and steps whenever possible.",
    "- If planning a single in-scope beat, put it in wave 1 and use later waves with empty beat lists for downstream phases.",
    "",
    "Output protocol (strict):",
    "1) Emit NDJSON progress lines while thinking:",
    '   {"event":"thinking","text":"..."}',
    "2) Emit one draft line per wave:",
    '   {"event":"wave_draft","wave":{"wave_index":1,"name":"...","objective":"...","beat_ids":["..."],"steps":[{"step_index":1,"beat_ids":["..."]}],"agents":[{"role":"backend","count":2,"specialty":"api"}],"notes":"..."}}',
    "3) Emit one final line:",
    `   {"event":"plan_final","plan":{"summary":"...","waves":[{"wave_index":1,"name":"...","objective":"...","beats":[{"id":"...","title":"..."}],"steps":[{"step_index":1,"beat_ids":["..."]}],"agents":[{"role":"...","count":1,"specialty":"..."}],"notes":"..."}],"unassigned_beat_ids":["..."],"assumptions":["..."]}}`,
    "4) Immediately repeat only the final plan JSON between tags:",
    `<${ORCHESTRATION_JSON_TAG}>`,
    "{...}",
    `</${ORCHESTRATION_JSON_TAG}>`,
    "",
    "Do not wrap output in Markdown code fences.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function normalizeAgents(
  raw: unknown,
): OrchestrationAgentSpec[] {
  if (!Array.isArray(raw)) return [];

  const normalized: OrchestrationAgentSpec[] = [];
  for (const item of raw) {
    const obj = toObject(item);
    if (!obj) continue;

    const role =
      typeof obj.role === "string" ? obj.role.trim() : "";
    if (!role) continue;

    const count = toInt(obj.count, 1);
    const specialty =
      typeof obj.specialty === "string" && obj.specialty.trim()
        ? obj.specialty.trim()
        : undefined;

    normalized.push({ role, count, specialty });
  }

  return normalized;
}

function selectKnownInputBeats(
  rawBeatsForWave: Array<{ id: string; title: string }>,
  beatTitleMap: Map<string, string>,
): Array<{ id: string; title: string }> {
  return rawBeatsForWave.filter((beat) => beatTitleMap.has(beat.id));
}

function selectFallbackWaveBeats(
  rawBeatsForWave: Array<{ id: string; title: string }>,
): Array<{ id: string; title: string }> {
  return rawBeatsForWave;
}

function collectWaveBeatIds(
  obj: JsonObject,
): { beatIds: Set<string>; explicitTitles: Map<string, string> } {
  const beatIds = new Set<string>();
  const explicitTitles = new Map<string, string>();

  const rawBeatIds = Array.isArray(obj.beat_ids) ? obj.beat_ids : [];
  for (const value of rawBeatIds) {
    if (typeof value !== "string" || !value.trim()) continue;
    beatIds.add(value.trim());
  }

  const rawBeats = Array.isArray(obj.beats) ? obj.beats : [];
  for (const value of rawBeats) {
    if (typeof value === "string" && value.trim()) {
      beatIds.add(value.trim());
      continue;
    }

    const beatObj = toObject(value);
    if (
      !beatObj ||
      typeof beatObj.id !== "string" ||
      !beatObj.id.trim()
    ) {
      continue;
    }

    const id = beatObj.id.trim();
    const title =
      typeof beatObj.title === "string" && beatObj.title.trim()
        ? beatObj.title.trim()
        : undefined;
    beatIds.add(id);
    if (title) explicitTitles.set(id, title);
  }

  const rawSteps = Array.isArray(obj.steps) ? obj.steps : [];
  for (const value of rawSteps) {
    const stepObj = toObject(value);
    const stepBeatIds = Array.isArray(stepObj?.beat_ids)
      ? stepObj.beat_ids
      : Array.isArray(stepObj?.beatIds)
        ? stepObj.beatIds
        : [];
    for (const stepBeatId of stepBeatIds) {
      if (
        typeof stepBeatId === "string" &&
        stepBeatId.trim()
      ) {
        beatIds.add(stepBeatId.trim());
      }
    }
  }

  return { beatIds, explicitTitles };
}

function normalizeWaveSteps(
  raw: JsonObject,
  beatIds: string[],
): OrchestrationWaveStep[] {
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  const normalized: OrchestrationWaveStep[] = [];
  for (const [index, value] of rawSteps.entries()) {
    const step = toObject(value);
    if (!step) continue;
    const rawBeatIds = Array.isArray(step.beat_ids)
      ? step.beat_ids
      : Array.isArray(step.beatIds)
        ? step.beatIds
        : [];
    const stepBeatIds = Array.from(
      new Set(
        rawBeatIds
          .filter(
            (item): item is string => typeof item === "string",
          )
          .map((item) => item.trim())
          .filter((item) => beatIds.includes(item)),
      ),
    );
    if (stepBeatIds.length === 0) continue;
    const notes =
      typeof step.notes === "string" && step.notes.trim()
        ? step.notes.trim()
        : undefined;
    normalized.push({
      stepIndex: toInt(
        step.step_index ?? step.stepIndex ?? index + 1,
        index + 1,
      ),
      beatIds: stepBeatIds,
      notes,
    });
  }
  normalized.sort((left, right) => left.stepIndex - right.stepIndex);

  if (normalized.length === 0) {
    return [{ stepIndex: 1, beatIds }];
  }

  const assigned = new Set(
    normalized.flatMap((step) => step.beatIds),
  );
  const unassigned = beatIds.filter((beatId) => !assigned.has(beatId));
  if (unassigned.length > 0) {
    normalized.push({
      stepIndex:
        Math.max(...normalized.map((step) => step.stepIndex)) + 1,
      beatIds: unassigned,
    });
  }

  return normalized;
}

export function normalizeWave(
  raw: unknown,
  fallbackIndex: number,
  beatTitleMap: Map<string, string>,
): OrchestrationWave | null {
  const obj = toObject(raw);
  if (!obj) return null;

  const waveIndex = toInt(
    obj.wave_index ?? obj.waveIndex ?? obj.index,
    fallbackIndex,
  );
  const name =
    typeof obj.name === "string" && obj.name.trim()
      ? obj.name.trim()
      : `Scene ${waveIndex}`;
  const objective =
    typeof obj.objective === "string" && obj.objective.trim()
      ? obj.objective.trim()
      : "Execute assigned beats for this scene.";
  const notes =
    typeof obj.notes === "string" && obj.notes.trim()
      ? obj.notes.trim()
      : undefined;
  const agents = normalizeAgents(obj.agents);
  const { beatIds, explicitTitles } = collectWaveBeatIds(obj);
  const rawBeatsForWave = Array.from(beatIds).map((id) => ({
    id,
    title: explicitTitles.get(id) ?? beatTitleMap.get(id) ?? id,
  }));
  const knownBeats = selectKnownInputBeats(rawBeatsForWave, beatTitleMap);
  const beats =
    knownBeats.length > 0
      ? knownBeats
      : selectFallbackWaveBeats(rawBeatsForWave);
  const steps = normalizeWaveSteps(
    obj,
    beats.map((beat) => beat.id),
  );

  return {
    waveIndex,
    name,
    objective,
    agents,
    beats,
    steps,
    notes,
  };
}

export function normalizePlan(
  raw: unknown,
  beatTitleMap: Map<string, string>,
): OrchestrationPlan | null {
  const obj = toObject(raw);
  if (!obj) return null;

  const rawWaves = Array.isArray(obj.waves) ? obj.waves : [];
  const waves = rawWaves
    .map((wave, index) => normalizeWave(wave, index + 1, beatTitleMap))
    .filter((wave): wave is OrchestrationWave => Boolean(wave))
    .sort((a, b) => a.waveIndex - b.waveIndex);

  if (waves.length === 0) return null;

  const assigned = new Set<string>();
  for (const wave of waves) {
    for (const beat of wave.beats) assigned.add(beat.id);
  }

  const inputIds = Array.from(beatTitleMap.keys());
  const rawUnassigned = Array.isArray(obj.unassigned_beat_ids)
    ? obj.unassigned_beat_ids
    : [];
  const normalizedUnassigned = rawUnassigned
    .filter((value): value is string => typeof value === "string")
    .filter((id) => beatTitleMap.has(id));

  for (const id of inputIds) {
    if (!assigned.has(id)) normalizedUnassigned.push(id);
  }

  const summary =
    typeof obj.summary === "string" && obj.summary.trim()
      ? obj.summary.trim()
      : `Generated ${waves.length} scene${waves.length === 1 ? "" : "s"}.`;
  const assumptions = Array.isArray(obj.assumptions)
    ? obj.assumptions.filter(
        (value): value is string => typeof value === "string",
      )
    : [];

  return {
    summary,
    waves,
    unassignedBeatIds: Array.from(new Set(normalizedUnassigned)),
    assumptions,
  };
}
