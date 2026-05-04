import { z } from "zod/v4";
import type { Beat } from "@/lib/types";
import {
  STALE_GROOMING_DECISIONS,
} from "@/lib/stale-beat-grooming-types";
import type {
  StaleBeatGroomingResult,
} from "@/lib/stale-beat-grooming-types";

const STALE_GROOMING_JSON_TAG = "stale_beat_grooming_json";

const staleGroomingOutputSchema = z.object({
  decision: z.enum(STALE_GROOMING_DECISIONS),
  rationale: z.string().trim().min(1),
  suggestedTitle: z.string().trim().optional(),
  suggestedDescription: z.string().trim().optional(),
  suggestedAcceptance: z.string().trim().optional(),
});

export function buildStaleBeatGroomingPrompt(input: {
  beat: Pick<
    Beat,
    "id" | "title" | "description" | "acceptance" | "state"
  >;
  ageDays: number;
}): string {
  const { beat } = input;
  return [
    "Review this stale backlog beat for product relevance.",
    "",
    `Beat ID: ${beat.id}`,
    `Current state: ${beat.state}`,
    `Age: ${input.ageDays} days`,
    `Title: ${beat.title}`,
    "",
    "Description:",
    beat.description?.trim() || "(none)",
    "",
    "Acceptance criteria:",
    beat.acceptance?.trim() || "(none)",
    "",
    "Choose exactly one decision:",
    "- still_do: the beat is still relevant as written.",
    "- reshape: the beat still matters, but its shape should change.",
    "- drop: the beat is no longer worth doing.",
    "",
    "Return only one JSON object between these tags:",
    `<${STALE_GROOMING_JSON_TAG}>`,
    JSON.stringify({
      decision: "still_do",
      rationale: "...",
      suggestedTitle: "...",
      suggestedDescription: "...",
      suggestedAcceptance: "...",
    }),
    `</${STALE_GROOMING_JSON_TAG}>`,
    "Omit suggested fields unless the decision is reshape.",
    "Do not wrap the response in Markdown code fences.",
  ].join("\n");
}

export function parseStaleBeatGroomingOutput(
  text: string,
): StaleBeatGroomingResult | null {
  const tagged = extractTaggedJson(text);
  const normalized = normalizeJsonCandidate(tagged ?? text);
  if (!normalized) return null;
  try {
    const parsed = staleGroomingOutputSchema.parse(
      JSON.parse(normalized),
    );
    return removeBlankSuggestions(parsed);
  } catch {
    return null;
  }
}

function extractTaggedJson(text: string): string | null {
  const re = new RegExp(
    `<${STALE_GROOMING_JSON_TAG}>`
      + "\\s*([\\s\\S]*?)\\s*"
      + `</${STALE_GROOMING_JSON_TAG}>`,
    "i",
  );
  return text.match(re)?.[1]?.trim() ?? null;
}

function normalizeJsonCandidate(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function removeBlankSuggestions(
  parsed: z.infer<typeof staleGroomingOutputSchema>,
): StaleBeatGroomingResult {
  return {
    decision: parsed.decision,
    rationale: parsed.rationale,
    ...(nonBlank(parsed.suggestedTitle)
      ? { suggestedTitle: parsed.suggestedTitle.trim() }
      : {}),
    ...(nonBlank(parsed.suggestedDescription)
      ? { suggestedDescription: parsed.suggestedDescription.trim() }
      : {}),
    ...(nonBlank(parsed.suggestedAcceptance)
      ? { suggestedAcceptance: parsed.suggestedAcceptance.trim() }
      : {}),
  };
}

function nonBlank(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
