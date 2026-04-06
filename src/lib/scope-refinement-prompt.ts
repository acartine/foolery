import { spawn } from "node:child_process";
import { z } from "zod/v4";
import {
  buildPromptModeArgs,
  createLineNormalizer,
  resolveDialect,
} from "@/lib/agent-adapter";
import type { AgentTarget } from "@/lib/types-agent-target";
import { getScopeRefinementAgent } from "@/lib/settings";
import {
  interpolateScopeRefinementPrompt,
} from "@/lib/scope-refinement-defaults";

const SCOPE_REFINEMENT_JSON_TAG = "scope_refinement_json";

export const PROMPT_TIMEOUT_MS = 600_000;

export const refinementOutputSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  acceptance: z.string().trim().optional(),
});

// ── Helpers ───────────────────────────────────────────────

function toObject(
  value: unknown,
): Record<string, unknown> | null {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    return null;
  }
  return value as Record<string, unknown>;
}

function appendAssistantText(
  current: string,
  text: string,
): string {
  if (!text) return current;
  return current ? `${current}\n${text}` : text;
}

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

// ── Event handlers ────────────────────────────────────────

interface PromptState {
  rawStdout: string;
  stderrText: string;
  ndjsonBuffer: string;
  assistantText: string;
  resultText: string;
}

function handleParsedEvent(
  obj: Record<string, unknown>,
  state: PromptState,
  safeReject: (e: Error) => void,
): void {
  if (obj.type === "stream_event") {
    const event = toObject(obj.event);
    const delta = toObject(event?.delta);
    if (
      event?.type === "content_block_delta"
      && delta?.type === "text_delta"
      && typeof delta.text === "string"
    ) {
      state.assistantText += delta.text;
    }
    return;
  }
  if (obj.type === "assistant") {
    const msg = toObject(obj.message);
    const content = Array.isArray(msg?.content)
      ? msg.content
      : [];
    const text = content
      .map((block) => {
        const o = toObject(block);
        return o?.type === "text"
          && typeof o.text === "string"
          ? o.text
          : "";
      })
      .join("");
    state.assistantText = appendAssistantText(
      state.assistantText, text,
    );
    return;
  }
  if (obj.type === "result") {
    handleResultEvent(obj, state, safeReject);
  }
}

function handleResultEvent(
  obj: Record<string, unknown>,
  state: PromptState,
  safeReject: (e: Error) => void,
): void {
  if (obj.is_error === true) {
    const m =
      typeof obj.result === "string"
        ? obj.result
        : typeof obj.error === "string"
          ? obj.error
          : "agent result error";
    safeReject(new Error(m));
  } else if (typeof obj.result === "string") {
    state.resultText = obj.result;
  } else if (typeof obj.error === "string") {
    safeReject(
      new Error(`agent result error: ${obj.error}`),
    );
  }
}

// ── Prompt runner (with timeout) ──────────────────────────

function spawnAndWire(
  built: { command: string; args: string[] },
  normalizeEvent: (v: unknown) => unknown,
  repoPath: string | undefined,
  resolve: (v: string) => void,
  reject: (e: Error) => void,
): void {
  let settled = false;
  const state: PromptState = {
    rawStdout: "",
    stderrText: "",
    ndjsonBuffer: "",
    assistantText: "",
    resultText: "",
  };

  const safeResolve = (value: string) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(value);
  };
  const safeReject = (error: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    reject(error);
  };

  const child = spawn(built.command, built.args, {
    cwd: repoPath?.trim() || process.cwd(),
    env: process.env,
  });

  const timer = setTimeout(() => {
    if (settled) return;
    child.kill("SIGKILL");
    safeReject(
      new Error(
        "scope refinement agent timed out after "
          + `${PROMPT_TIMEOUT_MS / 1000}s`,
      ),
    );
  }, PROMPT_TIMEOUT_MS);

  const processLine = (line: string) => {
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const obj = toObject(normalizeEvent(parsed));
    if (!obj || typeof obj.type !== "string") return;
    handleParsedEvent(obj, state, safeReject);
  };

  child.on("error", (e) => safeReject(e));

  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    state.rawStdout += text;
    state.ndjsonBuffer += text;
    const lines = state.ndjsonBuffer.split("\n");
    state.ndjsonBuffer = lines.pop() ?? "";
    for (const line of lines) processLine(line);
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    state.stderrText += chunk.toString();
  });

  child.on("close", (code) => {
    if (state.ndjsonBuffer.trim()) {
      processLine(state.ndjsonBuffer);
    }
    if (code !== 0) {
      const detail =
        state.stderrText.trim()
        || "scope refinement agent exited with "
          + `code ${code ?? "unknown"}`;
      safeReject(new Error(detail));
      return;
    }
    safeResolve(
      state.resultText
        || state.assistantText
        || state.rawStdout,
    );
  });
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
  const built = buildPromptModeArgs(agent, prompt);
  const dialect = resolveDialect(agent.command);
  const normalizeEvent = createLineNormalizer(dialect);

  return new Promise<string>((resolve, reject) => {
    spawnAndWire(
      built, normalizeEvent, repoPath,
      resolve, reject,
    );
  });
}

// ── Build refinement update ───────────────────────────────

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
