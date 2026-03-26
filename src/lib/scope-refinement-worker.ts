import { spawn } from "node:child_process";
import { z } from "zod/v4";
import { getBackend } from "@/lib/backend-instance";
import {
  buildPromptModeArgs,
  createLineNormalizer,
  resolveDialect,
} from "@/lib/agent-adapter";
import {
  getScopeRefinementAgent,
  getScopeRefinementSettings,
} from "@/lib/settings";

import {
  dequeueScopeRefinementJob,
  enqueueScopeRefinementJob,
  type ScopeRefinementJob,
} from "@/lib/scope-refinement-queue";
import { recordScopeRefinementCompletion } from "@/lib/scope-refinement-events";
import { interpolateScopeRefinementPrompt } from "@/lib/scope-refinement-defaults";

const SCOPE_REFINEMENT_JSON_TAG = "scope_refinement_json";
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_RETRIES = 2;

const refinementOutputSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  acceptance: z.string().trim().optional(),
});

interface WorkerState {
  intervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
  processing: boolean;
  /** Track retry counts by job beatId to prevent infinite loops. */
  retryCounts: Map<string, number>;
}

const g = globalThis as typeof globalThis & {
  __scopeRefinementWorkerState?: WorkerState;
};

function getWorkerState(): WorkerState {
  if (!g.__scopeRefinementWorkerState) {
    g.__scopeRefinementWorkerState = {
      intervalMs: DEFAULT_POLL_INTERVAL_MS,
      timer: null,
      processing: false,
      retryCounts: new Map(),
    };
  }
  return g.__scopeRefinementWorkerState;
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function appendAssistantText(current: string, text: string): string {
  if (!text) return current;
  return current ? `${current}\n${text}` : text;
}

function buildScopeRefinementPrompt(input: {
  title: string;
  description?: string;
  acceptance?: string;
  template: string;
}): string {
  return [
    interpolateScopeRefinementPrompt(input.template, input),
    "",
    "Return only one JSON object between these tags:",
    `<${SCOPE_REFINEMENT_JSON_TAG}>`,
    '{"title":"...","description":"...","acceptance":"..."}',
    `</${SCOPE_REFINEMENT_JSON_TAG}>`,
    "Do not wrap the response in Markdown code fences.",
  ].join("\n");
}

function extractTaggedJson(text: string): string | null {
  const match = text.match(
    new RegExp(
      `<${SCOPE_REFINEMENT_JSON_TAG}>\\s*([\\s\\S]*?)\\s*</${SCOPE_REFINEMENT_JSON_TAG}>`,
      "i",
    ),
  );
  return match?.[1]?.trim() ?? null;
}

function parseScopeRefinementOutput(text: string): z.infer<typeof refinementOutputSchema> | null {
  const tagged = extractTaggedJson(text);
  const candidate = tagged ?? text.trim();
  const normalized = candidate
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!normalized) return null;

  try {
    return refinementOutputSchema.parse(JSON.parse(normalized));
  } catch {
    return null;
  }
}

async function runScopeRefinementPrompt(
  prompt: string,
  repoPath?: string,
): Promise<string> {
  const agent = await getScopeRefinementAgent();
  if (!agent) {
    throw new Error("no scope refinement agent configured");
  }
  const built = buildPromptModeArgs(agent, prompt);
  const dialect = resolveDialect(agent.command);
  const normalizeEvent = createLineNormalizer(dialect);

  return await new Promise<string>((resolve, reject) => {
    let rawStdout = "";
    let stderrText = "";
    let ndjsonBuffer = "";
    let assistantText = "";
    let resultText = "";

    const child = spawn(built.command, built.args, {
      cwd: repoPath?.trim() || process.cwd(),
      env: process.env,
    });

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

      if (obj.type === "stream_event") {
        const event = toObject(obj.event);
        const delta = toObject(event?.delta);
        if (
          event?.type === "content_block_delta" &&
          delta?.type === "text_delta" &&
          typeof delta.text === "string"
        ) {
          assistantText += delta.text;
        }
        return;
      }

      if (obj.type === "assistant") {
        const message = toObject(obj.message);
        const content = Array.isArray(message?.content) ? message.content : [];
        const text = content
          .map((block) => {
            const blockObj = toObject(block);
            return blockObj?.type === "text" && typeof blockObj.text === "string"
              ? blockObj.text
              : "";
          })
          .join("");
        assistantText = appendAssistantText(assistantText, text);
        return;
      }

      if (obj.type === "result") {
        if (obj.is_error === true) {
          const msg = typeof obj.result === "string" ? obj.result
            : typeof obj.error === "string" ? obj.error
            : "agent result error";
          reject(new Error(msg));
        } else if (typeof obj.result === "string") {
          resultText = obj.result;
        } else if (obj.error && typeof obj.error === "string") {
          reject(new Error(`agent result error: ${obj.error}`));
        }
      }
    };

    child.on("error", (error) => reject(error));

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      rawStdout += text;
      ndjsonBuffer += text;
      const lines = ndjsonBuffer.split("\n");
      ndjsonBuffer = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrText += chunk.toString();
    });

    child.on("close", (code) => {
      if (ndjsonBuffer.trim()) processLine(ndjsonBuffer);
      if (code !== 0) {
        const detail = stderrText.trim() || `scope refinement agent exited with code ${code ?? "unknown"}`;
        reject(new Error(detail));
        return;
      }
      resolve(resultText || assistantText || rawStdout);
    });
  });
}

function buildRefinementUpdate(
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

  const nextDescription = refined.description?.trim();
  if (nextDescription && nextDescription !== (current.description ?? "")) {
    next.description = nextDescription;
  }

  const nextAcceptance = refined.acceptance?.trim();
  if (nextAcceptance && nextAcceptance !== (current.acceptance ?? "")) {
    next.acceptance = nextAcceptance;
  }

  return next;
}

/**
 * Re-enqueue a failed job if it has not exceeded the retry limit.
 * Returns true if the job was re-enqueued.
 */
function maybeReenqueue(job: ScopeRefinementJob, reason: string): boolean {
  const state = getWorkerState();
  const retries = state.retryCounts.get(job.beatId) ?? 0;
  if (retries >= MAX_RETRIES) {
    console.warn(
      `[scope-refinement] dropping job for ${job.beatId} after ${retries} retries: ${reason}`,
    );
    state.retryCounts.delete(job.beatId);
    return false;
  }
  state.retryCounts.set(job.beatId, retries + 1);
  enqueueScopeRefinementJob({ beatId: job.beatId, repoPath: job.repoPath });
  console.warn(
    `[scope-refinement] re-enqueued ${job.beatId} (retry ${retries + 1}/${MAX_RETRIES}): ${reason}`,
  );
  return true;
}

export async function processScopeRefinementJob(
  job: ScopeRefinementJob,
): Promise<void> {
  console.log(
    `[scope-refinement] processing ${job.beatId}`,
  );
  const settings = await getScopeRefinementSettings();

  const agent = await getScopeRefinementAgent();
  if (!agent) {
    console.warn(
      `[scope-refinement] skipping ${job.beatId}: no scope refinement agent configured`,
    );
    return;
  }

  const beatResult = await getBackend().get(job.beatId, job.repoPath);
  if (!beatResult.ok || !beatResult.data) {
    const reason = `failed to load beat: ${beatResult.error?.message ?? beatResult.error ?? "unknown error"}`;
    console.warn(`[scope-refinement] ${job.beatId}: ${reason}`);
    maybeReenqueue(job, reason);
    return;
  }

  const beat = beatResult.data;
  const prompt = buildScopeRefinementPrompt({
    title: beat.title,
    description: beat.description,
    acceptance: beat.acceptance,
    template: settings.prompt,
  });

  let rawResponse: string;
  try {
    rawResponse = await runScopeRefinementPrompt(prompt, job.repoPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[scope-refinement] agent failed for ${job.beatId}: ${message}`);
    maybeReenqueue(job, message);
    return;
  }

  const refined = parseScopeRefinementOutput(rawResponse);
  if (!refined) {
    console.warn(`[scope-refinement] could not parse agent output for ${job.beatId}`);
    maybeReenqueue(job, "unparseable agent output");
    return;
  }

  const update = buildRefinementUpdate(beat, refined);
  if (Object.keys(update).length > 0) {
    const updateResult = await getBackend().update(job.beatId, update, job.repoPath);
    if (!updateResult.ok) {
      console.warn(
        `[scope-refinement] failed to update ${job.beatId}: ${updateResult.error ?? "unknown error"}`,
      );
      maybeReenqueue(job, `update failed: ${updateResult.error ?? "unknown"}`);
      return;
    }
  }

  // Clear retry count on success
  getWorkerState().retryCounts.delete(job.beatId);

  console.log(
    `[scope-refinement] completed ${job.beatId}`,
  );
  recordScopeRefinementCompletion({
    beatId: job.beatId,
    beatTitle: update.title ?? beat.title,
    ...(job.repoPath ? { repoPath: job.repoPath } : {}),
  });
}

export async function drainScopeRefinementQueue(): Promise<void> {
  const state = getWorkerState();
  if (state.processing) return;

  state.processing = true;
  try {
    while (true) {
      const job = dequeueScopeRefinementJob();
      if (!job) break;
      try {
        await processScopeRefinementJob(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[scope-refinement] unexpected error processing ${job.beatId}: ${message}`);
        maybeReenqueue(job, message);
      }
    }
  } finally {
    state.processing = false;
  }
}

export function startScopeRefinementWorker(intervalMs = DEFAULT_POLL_INTERVAL_MS): void {
  const state = getWorkerState();
  if (state.timer) return;

  state.intervalMs = intervalMs;
  state.timer = setInterval(() => {
    void drainScopeRefinementQueue();
  }, intervalMs);
  void drainScopeRefinementQueue();
}

export function stopScopeRefinementWorker(): void {
  const state = getWorkerState();
  if (!state.timer) return;
  clearInterval(state.timer);
  state.timer = null;
}

/** Reset worker state including retry counts. Useful for testing. */
export function resetScopeRefinementWorkerState(): void {
  stopScopeRefinementWorker();
  const state = getWorkerState();
  state.retryCounts.clear();
}

export async function enqueueBeatScopeRefinement(
  beatId: string,
  repoPath?: string,
): Promise<ScopeRefinementJob | null> {
  const agent = await getScopeRefinementAgent();
  if (!agent) {
    console.log(
      `[scope-refinement] skipped ${beatId}:`
        + " no agent configured",
    );
    return null;
  }

  startScopeRefinementWorker();
  const job = enqueueScopeRefinementJob({
    beatId,
    repoPath,
  });
  console.log(
    `[scope-refinement] enqueued ${beatId}`,
  );
  return job;
}
