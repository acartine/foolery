import { spawn } from "node:child_process";

import {
  buildPromptModeArgs,
  createLineNormalizer,
  resolveDialect,
  type AgentDialect,
} from "@/lib/agent-adapter";
import { logTokenUsageForEvent } from "@/lib/agent-token-usage";
import {
  formatAgentDisplayLabel,
  toExecutionAgentInfo,
} from "@/lib/agent-identity";
import {
  noopInteractionLog,
  startInteractionLog,
  type InteractionLog,
} from "@/lib/interaction-logger";
import { extractPlanFromTaggedJson } from "@/lib/orchestration-plan-helpers";
import { getOrchestrationAgent } from "@/lib/settings";
import type { Beat, OrchestrationPlan } from "@/lib/types";

const EXECUTION_PLAN_TIMEOUT_MS = 3 * 60 * 1000;

interface ExecutionPlanPromptState {
  rawStdout: string;
  stderrText: string;
  ndjsonBuffer: string;
  assistantText: string;
  resultText: string;
}

interface ExecutionPlanRunnerContext {
  beatIds: string[];
  beatTitleMap: Map<string, string>;
  dialect: AgentDialect;
  normalizeEvent: (
    parsed: unknown,
  ) => Record<string, unknown> | null;
  interactionLog: InteractionLog;
  agentLabel: string;
}

function toObject(
  value: unknown,
): Record<string, unknown> | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
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

function toBeatTitleMap(
  beats: Beat[],
): Map<string, string> {
  return new Map(
    beats.map((beat) => [beat.id, beat.title]),
  );
}

function handleStreamEvent(
  obj: Record<string, unknown>,
  state: ExecutionPlanPromptState,
): void {
  const event = toObject(obj.event);
  const delta = toObject(event?.delta);
  if (
    event?.type === "content_block_delta" &&
    delta?.type === "text_delta" &&
    typeof delta.text === "string"
  ) {
    state.assistantText += delta.text;
  }
}

function handleAssistantEvent(
  obj: Record<string, unknown>,
  state: ExecutionPlanPromptState,
): void {
  const message = toObject(obj.message);
  const content = Array.isArray(message?.content)
    ? message.content
    : [];
  const text = content
    .map((block) => {
      const blockObj = toObject(block);
      return blockObj?.type === "text" &&
          typeof blockObj.text === "string"
        ? blockObj.text
        : "";
    })
    .join("");

  state.assistantText = appendAssistantText(
    state.assistantText,
    text,
  );
}

function handleTextEvent(
  obj: Record<string, unknown>,
  state: ExecutionPlanPromptState,
): void {
  const part = toObject(obj.part);
  const text =
    typeof part?.text === "string"
      ? part.text
      : typeof obj.text === "string"
        ? obj.text
        : "";

  state.assistantText = appendAssistantText(
    state.assistantText,
    text,
  );
}

function handleCompletedItemEvent(
  obj: Record<string, unknown>,
  state: ExecutionPlanPromptState,
): void {
  const item = toObject(obj.item);
  const itemType =
    typeof item?.type === "string" ? item.type : "";
  if (
    itemType !== "agent_message" &&
    itemType !== "assistant_message"
  ) {
    return;
  }

  const text =
    typeof item?.text === "string" ? item.text : "";
  state.assistantText = appendAssistantText(
    state.assistantText,
    text,
  );
}

function handleResultEvent(
  obj: Record<string, unknown>,
  state: ExecutionPlanPromptState,
  reject: (error: Error) => void,
): void {
  if (obj.is_error === true) {
    const message =
      typeof obj.result === "string"
        ? obj.result
        : typeof obj.error === "string"
          ? obj.error
          : "Execution plan generation failed.";
    reject(new Error(message));
    return;
  }

  if (typeof obj.result === "string") {
    state.resultText = obj.result;
    return;
  }

  if (typeof obj.error === "string") {
    reject(new Error(obj.error));
  }
}

function handlePlannerEvent(
  obj: Record<string, unknown>,
  state: ExecutionPlanPromptState,
  reject: (error: Error) => void,
): void {
  if (obj.type === "stream_event") {
    handleStreamEvent(obj, state);
    return;
  }
  if (obj.type === "assistant") {
    handleAssistantEvent(obj, state);
    return;
  }
  if (obj.type === "text") {
    handleTextEvent(obj, state);
    return;
  }
  if (obj.type === "item.completed") {
    handleCompletedItemEvent(obj, state);
    return;
  }
  if (obj.type === "result") {
    handleResultEvent(obj, state, reject);
  }
}

function resolveExecutionPlanFromState(
  state: ExecutionPlanPromptState,
  beatTitleMap: Map<string, string>,
): OrchestrationPlan | null {
  const candidates = [
    state.resultText,
    state.assistantText,
    state.rawStdout,
  ];

  for (const candidate of candidates) {
    const text = candidate.trim();
    if (!text) continue;
    const plan = extractPlanFromTaggedJson(
      text,
      beatTitleMap,
    );
    if (plan) return plan;
  }

  return null;
}

async function createExecutionPlanInteractionLog(
  repoPath: string,
  beatIds: string[],
  agent: Awaited<
    ReturnType<typeof getOrchestrationAgent>
  >,
): Promise<InteractionLog> {
  return startInteractionLog({
    sessionId:
      `plan-${Date.now()}-` +
      `${Math.random().toString(36).slice(2, 8)}`,
    interactionType: "direct",
    repoPath,
    beatIds,
    agentName: toExecutionAgentInfo(agent).agentName,
    agentModel: agent.model,
    agentVersion: agent.version,
  }).catch((error) => {
    console.error(
      "[execution-plan-generation] Failed to start interaction log:",
      error,
    );
    return noopInteractionLog();
  });
}

function createExecutionPlanPromptState(): ExecutionPlanPromptState {
  return {
    rawStdout: "",
    stderrText: "",
    ndjsonBuffer: "",
    assistantText: "",
    resultText: "",
  };
}

function processPlannerLine(
  line: string,
  state: ExecutionPlanPromptState,
  context: ExecutionPlanRunnerContext,
  finishReject: (error: Error, exitCode: number | null) => void,
): void {
  if (!line.trim()) return;
  context.interactionLog.logResponse(line);

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }

  logTokenUsageForEvent(
    context.interactionLog,
    context.dialect,
    parsed,
    context.beatIds,
  );

  const obj = toObject(context.normalizeEvent(parsed));
  if (!obj || typeof obj.type !== "string") return;
  handlePlannerEvent(obj, state, (error) =>
    finishReject(error, null),
  );
}

function handleStdoutChunk(
  chunk: Buffer,
  state: ExecutionPlanPromptState,
  interactionLog: InteractionLog,
  processLine: (line: string) => void,
): void {
  const text = chunk.toString();
  interactionLog.logStdout(text);
  state.rawStdout += text;
  state.ndjsonBuffer += text;

  const lines = state.ndjsonBuffer.split("\n");
  state.ndjsonBuffer = lines.pop() ?? "";
  for (const line of lines) processLine(line);
}

function handleCloseEvent(input: {
  code: number | null;
  signal: string | null;
  state: ExecutionPlanPromptState;
  processLine: (line: string) => void;
  context: ExecutionPlanRunnerContext;
  finishResolve: (
    plan: OrchestrationPlan,
    exitCode: number | null,
  ) => void;
  finishReject: (
    error: Error,
    exitCode: number | null,
  ) => void;
}): void {
  if (input.state.ndjsonBuffer.trim()) {
    input.processLine(input.state.ndjsonBuffer);
  }

  const isSuccess =
    input.code === 0 && input.signal == null;
  if (!isSuccess) {
    const detail =
      input.state.stderrText.trim() ||
      `${input.context.agentLabel} exited ` +
        `(code=${input.code ?? "null"}, signal=${input.signal ?? "null"})`;
    input.finishReject(new Error(detail), input.code);
    return;
  }

  const plan = resolveExecutionPlanFromState(
    input.state,
    input.context.beatTitleMap,
  );
  if (!plan) {
    input.finishReject(
      new Error(
        "Execution plan generation finished without a tagged plan.",
      ),
      input.code,
    );
    return;
  }

  input.finishResolve(plan, input.code);
}

function wireExecutionPlanChild(
  child: ReturnType<typeof spawn>,
  state: ExecutionPlanPromptState,
  context: ExecutionPlanRunnerContext,
  finishResolve: (
    plan: OrchestrationPlan,
    exitCode: number | null,
  ) => void,
  finishReject: (
    error: Error,
    exitCode: number | null,
  ) => void,
): void {
  const processLine = (line: string) =>
    processPlannerLine(
      line,
      state,
      context,
      finishReject,
    );

  child.on("error", (error) => {
    finishReject(
      new Error(
        `Failed to start ${context.agentLabel}: ${error.message}`,
      ),
      null,
    );
  });

  child.stdout?.on("data", (chunk: Buffer) => {
    handleStdoutChunk(
      chunk,
      state,
      context.interactionLog,
      processLine,
    );
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    context.interactionLog.logStderr(text);
    state.stderrText += text;
  });

  child.on("close", (code, signal) => {
    handleCloseEvent({
      code,
      signal,
      state,
      processLine,
      context,
      finishResolve,
      finishReject,
    });
  });
}

export async function runExecutionPlanPrompt(input: {
  repoPath: string;
  beatIds: string[];
  beats: Beat[];
  prompt: string;
  model?: string;
}): Promise<OrchestrationPlan> {
  const agent = await getOrchestrationAgent(input.model);
  const interactionLog =
    await createExecutionPlanInteractionLog(
      input.repoPath,
      input.beatIds,
      agent,
    );
  interactionLog.logPrompt(input.prompt, {
    source: "execution_plan",
  });

  const built = buildPromptModeArgs(
    agent,
    input.prompt,
  );
  const dialect: AgentDialect = resolveDialect(
    built.command,
  );
  const context: ExecutionPlanRunnerContext = {
    beatIds: input.beatIds,
    beatTitleMap: toBeatTitleMap(input.beats),
    dialect,
    normalizeEvent: createLineNormalizer(dialect),
    interactionLog,
    agentLabel: formatAgentDisplayLabel(agent),
  };

  return new Promise<OrchestrationPlan>(
    (resolve, reject) => {
      let settled = false;
      const state = createExecutionPlanPromptState();

      const finishResolve = (
        plan: OrchestrationPlan,
        exitCode: number | null,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        interactionLog.logEnd(exitCode, "completed");
        resolve(plan);
      };

      const finishReject = (
        error: Error,
        exitCode: number | null,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        interactionLog.logEnd(exitCode, "error");
        reject(error);
      };

      const child = spawn(
        built.command,
        built.args,
        {
          cwd: input.repoPath,
          env: { ...process.env },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finishReject(
          new Error(
            "Timed out waiting for execution plan " +
              `after ${EXECUTION_PLAN_TIMEOUT_MS}ms.`,
          ),
          null,
        );
      }, EXECUTION_PLAN_TIMEOUT_MS);
      wireExecutionPlanChild(
        child,
        state,
        context,
        finishResolve,
        finishReject,
      );
    },
  );
}
