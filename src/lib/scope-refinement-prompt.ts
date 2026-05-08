import { z } from "zod/v4";
import { runAgentPrompt } from "@/lib/agent-prompt-runner";
import type { AgentTarget } from "@/lib/types-agent-target";
import { getScopeRefinementAgent } from "@/lib/settings";
import {
  interpolateScopeRefinementPrompt,
} from "@/lib/scope-refinement-defaults";

const SCOPE_REFINEMENT_JSON_TAG = "scope_refinement_json";

export const PROMPT_TIMEOUT_MS = 600_000;
const NO_OUTPUT_WARN_MS = 120_000;

export const refinementOutputSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  acceptance: z.string().trim().optional(),
});

export function buildScopeRefinementPrompt(input: {
  title: string;
  description?: string;
  acceptance?: string;
  template: string;
}): string {
  return [
    interpolateScopeRefinementPrompt(
      input.template, input,
    ),
    "",
    "Return only one JSON object between these tags:",
    `<${SCOPE_REFINEMENT_JSON_TAG}>`,
    '{"title":"...","description":"...","acceptance":"..."}',
    `</${SCOPE_REFINEMENT_JSON_TAG}>`,
    "Do not wrap the response in Markdown code fences.",
  ].join("\n");
}

function extractTaggedJson(
  text: string,
): string | null {
  const re = new RegExp(
    `<${SCOPE_REFINEMENT_JSON_TAG}>`
      + `\\s*([\\s\\S]*?)\\s*`
      + `</${SCOPE_REFINEMENT_JSON_TAG}>`,
    "i",
  );
  return text.match(re)?.[1]?.trim() ?? null;
}

export function parseScopeRefinementOutput(
  text: string,
): z.infer<typeof refinementOutputSchema> | null {
  const tagged = extractTaggedJson(text);
  const candidate = tagged ?? text.trim();
  const normalized = candidate
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!normalized) return null;

  try {
    return refinementOutputSchema.parse(
      JSON.parse(normalized),
    );
  } catch {
    return null;
  }
}

export async function runScopeRefinementPrompt(
  prompt: string,
  repoPath?: string,
  preResolvedAgent?: AgentTarget,
): Promise<string> {
  const agent =
    preResolvedAgent ?? await getScopeRefinementAgent();
  if (!agent) {
    throw new Error(
      "no scope refinement agent configured",
    );
  }
  return runAgentPrompt({
    subsystem: "scope-refinement",
    subsystemLabel: "scope refinement",
    timeoutMs: PROMPT_TIMEOUT_MS,
    noOutputWarnMs: NO_OUTPUT_WARN_MS,
    prompt,
    agent,
    ...(repoPath ? { repoPath } : {}),
  });
}

export function buildRefinementUpdate(
  current: {
    title: string;
    description?: string;
    acceptance?: string;
  },
  refined: z.infer<typeof refinementOutputSchema>,
): {
  title?: string;
  description?: string;
  acceptance?: string;
} {
  const next: {
    title?: string;
    description?: string;
    acceptance?: string;
  } = {};

  const nextTitle = refined.title.trim();
  if (nextTitle && nextTitle !== current.title) {
    next.title = nextTitle;
  }
  const nextDesc = refined.description?.trim();
  if (
    nextDesc
    && nextDesc !== (current.description ?? "")
  ) {
    next.description = nextDesc;
  }
  const nextAcc = refined.acceptance?.trim();
  if (
    nextAcc
    && nextAcc !== (current.acceptance ?? "")
  ) {
    next.acceptance = nextAcc;
  }
  return next;
}
