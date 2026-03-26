/**
 * Orchestration plan normalisation, prompt construction, and NDJSON
 * event helpers.  Split from orchestration-internals.ts to keep each
 * file within the 500-line (code) limit.
 */

import type {
  Beat,
  OrchestrationAgentSpec,
  OrchestrationPlan,
  OrchestrationWave,
} from "@/lib/types";

import {
  type OrchestrationSessionEntry,
  type JsonObject,
  type PromptScopeBeat,
  ORCHESTRATION_JSON_TAG,
  toObject,
  toInt,
  pushEvent,
} from "@/lib/orchestration-internals";

// ── Scope derivation ────────────────────────────────────────────────

export function extractObjectiveBeatIds(
  objective?: string,
): string[] {
  if (!objective?.trim()) return [];

  const beatIdPattern = /\b[a-z0-9]+-[a-z0-9]+(?:\.[0-9]+)*\b/gi;
  const matches = objective.match(beatIdPattern) ?? [];
  return Array.from(
    new Set(matches.map((match) => match.trim().toLowerCase()))
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
      unresolvedScopeIds.push(
        normalizedToOriginal.get(id) ?? id,
      );
      continue;
    }

    scopedBeats.push({
      id: beat.id,
      title: beat.title,
      type: beat.type,
      state: beat.state,
      priority: beat.priority,
    });
  }

  scopedBeats.sort((a, b) => a.id.localeCompare(b.id));
  unresolvedScopeIds.sort((a, b) => a.localeCompare(b));
  return { scopedBeats, unresolvedScopeIds };
}

// ── Prompt construction ─────────────────────────────────────────────

export function buildPrompt(
  repoPath: string,
  scopedBeats: PromptScopeBeat[],
  unresolvedScopeIds: string[],
  objective?: string,
): string {
  const hasExplicitScope =
    scopedBeats.length > 0 || unresolvedScopeIds.length > 0;
  return [
    "You are an orchestration planner for engineering work tracked as issues/work items.",
    "Create execution waves that respect dependencies while maximizing useful parallelism.",
    `Repository: ${repoPath}`,
    objective && objective.trim()
      ? `Planning objective: ${objective.trim()}`
      : "Planning objective: Minimize lead time while keeping waves coherent.",
    "",
    "Scope guidance:",
    hasExplicitScope
      ? "Use the explicit work-item IDs below as the in-scope planning set."
      : "No explicit beat IDs were provided. Infer scope from the objective and inspect beats as needed.",
    ...scopedBeats.map(
      (beat) =>
        `- ${beat.id} [${beat.type}, ${beat.state}, P${beat.priority}]: ${beat.title}`,
    ),
    ...(unresolvedScopeIds.length > 0
      ? [
          "Objective mentioned IDs not present in open/in_progress/blocked work items:",
          ...unresolvedScopeIds.map((id) => `- ${id}`),
        ]
      : []),
    "",
    "Use your memory manager CLI commands to inspect missing context instead of guessing.",
    "",
    "Hard rules:",
    "- Every in-scope beat ID must appear in exactly one wave or in unassigned_beat_ids.",
    "- If blocker -> blocked, blocker must be in an earlier wave than blocked when both are in-scope.",
    "- For each wave, propose agent roles and count. Specialty is optional but useful.",
    "- Keep wave names short and concrete.",
    "- Do not hide execution structure only in notes: emit separate waves whenever possible.",
    "- If planning a single in-scope beat, put it in wave 1 and use later waves with empty beat lists for downstream phases.",
    "",
    "Output protocol (strict):",
    "1) Emit NDJSON progress lines while thinking:",
    '   {"event":"thinking","text":"..."}',
    "2) Emit one draft line per wave:",
    '   {"event":"wave_draft","wave":{"wave_index":1,"name":"...","objective":"...","beat_ids":["..."],"agents":[{"role":"backend","count":2,"specialty":"api"}],"notes":"..."}}',
    "3) Emit one final line:",
    `   {"event":"plan_final","plan":{"summary":"...","waves":[{"wave_index":1,"name":"...","objective":"...","beats":[{"id":"...","title":"..."}],"agents":[{"role":"...","count":1,"specialty":"..."}],"notes":"..."}],"unassigned_beat_ids":["..."],"assumptions":["..."]}}`,
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

// ── Wave / plan normalisation ───────────────────────────────────────

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
  return rawBeatsForWave.filter((beat) =>
    beatTitleMap.has(beat.id),
  );
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

  const rawBeatIds = Array.isArray(obj.beat_ids)
    ? obj.beat_ids
    : [];
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

  return { beatIds, explicitTitles };
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
    title:
      explicitTitles.get(id) ?? beatTitleMap.get(id) ?? id,
  }));

  const knownBeats = selectKnownInputBeats(
    rawBeatsForWave,
    beatTitleMap,
  );

  const beats =
    knownBeats.length > 0
      ? knownBeats
      : selectFallbackWaveBeats(rawBeatsForWave);

  return {
    waveIndex,
    name,
    objective,
    agents,
    beats,
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
    .map((wave, index) =>
      normalizeWave(wave, index + 1, beatTitleMap),
    )
    .filter(
      (wave): wave is OrchestrationWave => Boolean(wave),
    )
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
    .filter(
      (value): value is string => typeof value === "string",
    )
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
        (value): value is string =>
          typeof value === "string",
      )
    : [];

  return {
    summary,
    waves,
    unassignedBeatIds: Array.from(
      new Set(normalizedUnassigned),
    ),
    assumptions,
  };
}

// ── Draft plan helpers ──────────────────────────────────────────────

export function buildDraftPlan(
  entry: OrchestrationSessionEntry,
): OrchestrationPlan {
  const waves = Array.from(entry.draftWaves.values()).sort(
    (a, b) => a.waveIndex - b.waveIndex,
  );

  const assigned = new Set<string>();
  for (const wave of waves) {
    for (const beat of wave.beats) assigned.add(beat.id);
  }

  const unassigned = Array.from(entry.allBeats.keys()).filter(
    (id) => !assigned.has(id),
  );

  return {
    summary: `Drafting ${waves.length} scene${waves.length === 1 ? "" : "s"}...`,
    waves,
    unassignedBeatIds: unassigned,
    assumptions: [],
  };
}

export function extractPlanFromTaggedJson(
  text: string,
  beatTitleMap: Map<string, string>,
): OrchestrationPlan | null {
  const pattern = new RegExp(
    `<${ORCHESTRATION_JSON_TAG}>\\s*([\\s\\S]*?)` +
      `\\s*</${ORCHESTRATION_JSON_TAG}>`,
    "i",
  );
  const match = text.match(pattern);
  if (!match || !match[1]) return null;

  try {
    const parsed = JSON.parse(match[1]);
    return normalizePlan(parsed, beatTitleMap);
  } catch {
    return null;
  }
}

// ── NDJSON line event processing ────────────────────────────────────

export function applyLineEvent(
  entry: OrchestrationSessionEntry,
  line: string,
) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }

  const obj = toObject(parsed);
  if (!obj || typeof obj.event !== "string") return;

  if (obj.event === "wave_draft") {
    const wave = normalizeWave(
      obj.wave ?? obj,
      entry.draftWaves.size + 1,
      new Map(
        Array.from(entry.allBeats.values()).map((b) => [
          b.id,
          b.title,
        ]),
      ),
    );
    if (!wave) return;

    entry.draftWaves.set(wave.waveIndex, wave);
    const draftPlan = buildDraftPlan(entry);
    entry.session.plan = draftPlan;
    pushEvent(entry, "plan", draftPlan);
    return;
  }

  if (obj.event === "plan_final") {
    const beatTitleMap = new Map(
      Array.from(entry.allBeats.values()).map((b) => [
        b.id,
        b.title,
      ]),
    );
    const plan = normalizePlan(obj.plan ?? obj, beatTitleMap);
    if (!plan) return;

    entry.session.plan = plan;
    pushEvent(entry, "plan", plan);
  }
}

// ── Logging helpers ─────────────────────────────────────────────────

function formatLogValue(value: unknown): string {
  const raw =
    typeof value === "string" ? value : JSON.stringify(value);
  if (!raw) return "";
  return raw.length > 220
    ? `${raw.slice(0, 220)}...`
    : raw;
}

export function formatStructuredLogLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return `${line}\n`;
  }

  try {
    const parsed = JSON.parse(trimmed);
    const obj = toObject(parsed);
    if (!obj || typeof obj.event !== "string") {
      return `${line}\n`;
    }

    const text =
      typeof obj.text === "string"
        ? obj.text
        : typeof obj.message === "string"
          ? obj.message
          : typeof obj.result === "string"
            ? obj.result
            : "";

    const extras = Object.entries(obj)
      .filter(
        ([key]) =>
          !["event", "text", "message", "result"].includes(
            key,
          ),
      )
      .map(([key, value]) => ({
        key,
        value: formatLogValue(value),
      }))
      .filter((entry) => entry.value.length > 0);

    const out = [`${obj.event} | ${text || "(no text)"}\n`];
    for (const extra of extras) {
      out.push(`  ${extra.key}: ${extra.value}\n`);
    }
    return out.join("");
  } catch {
    return `${line}\n`;
  }
}

export function consumeAssistantText(
  entry: OrchestrationSessionEntry,
  delta: string,
): string[] {
  entry.assistantText += delta;
  entry.lineBuffer += delta;
  const completedLines: string[] = [];

  let newlineIndex = entry.lineBuffer.indexOf("\n");
  while (newlineIndex !== -1) {
    const line = entry.lineBuffer.slice(0, newlineIndex);
    entry.lineBuffer = entry.lineBuffer.slice(newlineIndex + 1);
    applyLineEvent(entry, line);
    completedLines.push(line);
    newlineIndex = entry.lineBuffer.indexOf("\n");
  }

  return completedLines;
}

export function summarizeResult(
  result: unknown,
  isError: boolean,
): string {
  if (!isError) return "Claude orchestration complete";
  if (typeof result !== "string" || !result.trim()) {
    return "Claude orchestration failed";
  }

  const firstLine = result
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return "Claude orchestration failed";
  return firstLine.length > 180
    ? `Claude orchestration failed: ${firstLine.slice(0, 180)}...`
    : `Claude orchestration failed: ${firstLine}`;
}
