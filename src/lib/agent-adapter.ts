/**
 * Agent adapter — encapsulates CLI dialect differences between agent CLIs.
 *
 * Three responsibilities:
 *   1. Dialect resolution  — detect agent CLI type from command name
 *   2. Arg building        — construct correct CLI args per dialect
 *   3. Event normalization — convert JSONL events to the Claude shapes
 *                            that orchestration/breakdown/terminal parsers expect
 */

import type { RegisteredAgent } from "@/lib/types";
import type { AgentTarget } from "@/lib/types-agent-target";

// ── Types ───────────────────────────────────────────────────

export type AgentDialect =
  | "claude"
  | "codex"
  | "copilot"
  | "opencode"
  | "gemini";

export interface PromptModeArgs {
  command: string;
  args: string[];
}

// ── 1) Dialect resolution ───────────────────────────────────

/**
 * Determine CLI dialect from a command string.
 * Any path or name containing "codex" or "chatgpt" → codex;
 * "opencode" → opencode; everything else → claude.
 */
export function resolveDialect(command: string): AgentDialect {
  const base = command.includes("/")
    ? command.slice(command.lastIndexOf("/") + 1)
    : command;
  const lower = base.toLowerCase();
  if (lower.includes("gemini")) return "gemini";
  if (lower.includes("copilot")) return "copilot";
  if (lower.includes("opencode")) return "opencode";
  if (lower.includes("codex") || lower.includes("chatgpt")) return "codex";
  return "claude";
}

// ── 2) Arg building ────────────────────────────────────────

/**
 * Build CLI args for an interactive Codex session
 * using the app-server JSON-RPC stdio protocol.
 */
export function buildCodexInteractiveArgs(
  agent: RegisteredAgent | AgentTarget,
): PromptModeArgs {
  const command =
    "command" in agent &&
    typeof agent.command === "string"
      ? agent.command
      : "codex";
  const args = [
    "app-server", "--listen", "stdio://",
  ];
  if (agent.model) {
    args.push("-c", `model="${agent.model}"`);
  }
  return { command, args };
}

/**
 * Build CLI args for an interactive Copilot session.
 * Uses `--session` mode with NDJSON stdin/stdout.
 */
export function buildCopilotInteractiveArgs(
  agent: RegisteredAgent | AgentTarget,
): PromptModeArgs {
  const command =
    "command" in agent &&
    typeof agent.command === "string"
      ? agent.command
      : "copilot";
  const args = [
    "--session",
    "--output-format", "json",
    "--stream", "on",
    "--allow-all",
  ];
  if (agent.model) {
    args.push("--model", agent.model);
  }
  return { command, args };
}

/**
 * Build CLI args for an interactive OpenCode session.
 * Uses `opencode serve` headless mode with HTTP API.
 */
export function buildOpenCodeInteractiveArgs(
  agent: RegisteredAgent | AgentTarget,
): PromptModeArgs {
  const command =
    "command" in agent &&
    typeof agent.command === "string"
      ? agent.command
      : "opencode";
  const args = [
    "serve", "--port", "0", "--print-logs",
  ];
  if (agent.model) {
    args.push("-m", agent.model);
  }
  return { command, args };
}

/** Build CLI args for interactive Gemini (ACP). */
export function buildGeminiInteractiveArgs(
  agent: RegisteredAgent | AgentTarget,
): PromptModeArgs {
  const command =
    "command" in agent &&
    typeof agent.command === "string"
      ? agent.command : "gemini";
  const args = ["--acp", "--yolo"];
  if (agent.model) args.push("-m", agent.model);
  return { command, args };
}

/**
 * Build CLI args for a one-shot prompt invocation (orchestration / breakdown).
 *
 * Claude: `claude -p ... --output-format stream-json`
 * Codex: `codex exec ... --json`
 * Copilot: `copilot -p ... --output-format json --stream on`
 * OpenCode: `opencode run ... --format json`
 */
export function buildPromptModeArgs(
  agent: RegisteredAgent | AgentTarget,
  prompt: string,
): PromptModeArgs {
  const command = "command" in agent && typeof agent.command === "string"
    ? agent.command
    : "claude";
  const dialect = resolveDialect(command);

  if (dialect === "gemini") {
    const args = [
      "-p",
      prompt,
      "-o",
      "stream-json",
      "-y",
    ];
    if (agent.model) args.push("-m", agent.model);
    return { command, args };
  }

  if (dialect === "opencode") {
    const args = ["run", "--format", "json"];
    if (agent.model) args.push("-m", agent.model);
    args.push(prompt);
    return { command, args };
  }

  if (dialect === "copilot") {
    const args = [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--stream",
      "on",
      "--allow-all",
      "--no-ask-user",
    ];
    if (agent.model) args.push("--model", agent.model);
    return { command, args };
  }

  if (dialect === "codex") {
    const args = [
      "exec",
      prompt,
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
    ];
    if (agent.model) args.push("-m", agent.model);
    return { command, args };
  }

  // claude dialect
  const args = [
    "-p",
    prompt,
    "--input-format",
    "text",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--dangerously-skip-permissions",
  ];
  if (agent.model) args.push("--model", agent.model);
  return { command, args };
}

// ── 3) Event normalization ──────────────────────────────────

/**
 * Returns a function that normalizes a single parsed JSON line from the agent's
 * JSONL stream into the Claude-shaped event the existing parsers expect.
 *
 * For "claude" dialect the normalizer is identity (passthrough).
 * For "codex" dialect the normalizer maps Codex events → Claude shapes.
 * For "copilot" dialect the normalizer maps Copilot session events → Claude shapes.
 * For "opencode" dialect the normalizer maps OpenCode JSON events → Claude shapes.
 *
 * Returns `null` for events that should be skipped.
 */
export function createLineNormalizer(
  dialect: AgentDialect,
): (parsed: unknown) => Record<string, unknown> | null {
  if (dialect === "claude") {
    return (parsed) => {
      if (!parsed || typeof parsed !== "object") return null;
      return parsed as Record<string, unknown>;
    };
  }

  if (dialect === "gemini") {
    return createGeminiNormalizer();
  }

  if (dialect === "opencode") {
    return createOpenCodeNormalizer();
  }

  if (dialect === "copilot") {
    return createCopilotNormalizer();
  }

  return createCodexNormalizer();
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

// ── Gemini normalizer ──────────────────────────────────────

/**
 * Gemini stream-json events:
 *   init      → skip
 *   message (role:user) → skip
 *   message (role:assistant, delta:true) → assistant text
 *   result (status:success|error) → result
 */
function createGeminiNormalizer(
): (parsed: unknown) => Record<string, unknown> | null {
  let accumulatedText = "";

  return (parsed) => {
    const obj = toObject(parsed);
    if (!obj || typeof obj.type !== "string") return null;

    if (obj.type === "init") return null;

    if (obj.type === "message") {
      if (obj.role === "user") return null;
      const text =
        typeof obj.content === "string"
          ? obj.content : "";
      if (text) {
        accumulatedText +=
          (accumulatedText ? "\n" : "") + text;
      }
      return {
        type: "assistant",
        message: {
          content: [{ type: "text", text }],
        },
      };
    }

    if (obj.type === "result") {
      const status = obj.status;
      const isError = status !== "success";
      return {
        type: "result",
        result: accumulatedText
          || (isError ? "Gemini error" : ""),
        is_error: isError,
      };
    }

    return null;
  };
}

// ── OpenCode normalizer ─────────────────────────────────────

function createOpenCodeNormalizer(
): (parsed: unknown) => Record<string, unknown> | null {
  let accumulatedText = "";

  return (parsed) => {
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    const type = obj.type;

    if (type === "step_start") return null;

    if (type === "text") {
      const part = obj.part as Record<string, unknown> | undefined;
      const text = typeof part?.text === "string" ? part.text : "";
      accumulatedText += (accumulatedText ? "\n" : "") + text;
      return {
        type: "assistant",
        message: { content: [{ type: "text", text }] },
      };
    }

    if (type === "step_finish") {
      const part = obj.part as Record<string, unknown> | undefined;
      const reason =
        typeof part?.reason === "string" ? part.reason : "";
      return {
        type: "result",
        result: accumulatedText,
        is_error: reason === "error",
      };
    }

    return null;
  };
}

// ── Copilot normalizer ──────────────────────────────────────

type CopilotState = {
  accumulatedText: string;
  streamedMessageIds: Set<string>;
};

function normalizeCopilotMessageDelta(
  data: Record<string, unknown> | null,
  state: CopilotState,
): Record<string, unknown> | null {
  const messageId =
    typeof data?.messageId === "string"
      ? data.messageId
      : undefined;
  const delta =
    typeof data?.deltaContent === "string"
      ? data.deltaContent
      : "";
  if (!delta) return null;
  if (messageId) state.streamedMessageIds.add(messageId);
  state.accumulatedText += delta;
  return {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text: delta },
    },
  };
}

function collectCopilotToolBlocks(
  toolRequests: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(toolRequests)) return [];
  return toolRequests.flatMap((rawRequest) => {
    const request = toObject(rawRequest);
    if (!request || typeof request.name !== "string") return [];
    return [{
      type: "tool_use",
      ...(typeof request.toolCallId === "string"
        ? { id: request.toolCallId }
        : {}),
      name: request.name,
      input: toObject(request.arguments) ?? {},
    }];
  });
}

function normalizeCopilotAssistantMessage(
  data: Record<string, unknown> | null,
  state: CopilotState,
): Record<string, unknown> | null {
  if (!data) return null;

  const messageId =
    typeof data.messageId === "string"
      ? data.messageId
      : undefined;
  const content =
    typeof data.content === "string"
      ? data.content
      : "";
  const blocks = collectCopilotToolBlocks(data.toolRequests);

  if (content && (!messageId || !state.streamedMessageIds.has(messageId))) {
    state.accumulatedText +=
      (state.accumulatedText ? "\n" : "") + content;
    blocks.unshift({ type: "text", text: content });
  }

  return blocks.length > 0
    ? { type: "assistant", message: { content: blocks } }
    : null;
}

function normalizeCopilotUserInput(
  data: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const question =
    typeof data?.question === "string"
      ? data.question
      : "";
  if (!question) return null;

  const rawChoices = Array.isArray(data?.choices)
    ? data.choices
    : [];
  const options = rawChoices
    .filter(
      (choice): choice is string =>
        typeof choice === "string" && choice.trim().length > 0,
    )
    .map((label) => ({ label }));
  const toolUseId =
    typeof data?.toolCallId === "string"
      ? data.toolCallId
      : typeof data?.requestId === "string"
        ? data.requestId
        : undefined;

  return {
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        ...(toolUseId ? { id: toolUseId } : {}),
        name: "AskUserQuestion",
        input: { questions: [{ question, options }] },
      }],
    },
  };
}

function normalizeCopilotSessionEvent(
  obj: Record<string, unknown>,
  accumulatedText: string,
): Record<string, unknown> | null {
  if (obj.type === "session.task_complete") {
    const data = toObject(obj.data);
    const summary =
      typeof data?.summary === "string"
        ? data.summary
        : "";
    const success = data?.success !== false;
    return {
      type: "result",
      result:
        accumulatedText
        || summary
        || (success ? "" : "Task failed"),
      is_error: !success,
    };
  }

  if (obj.type === "session.error") {
    const data = toObject(obj.data);
    const message =
      typeof data?.message === "string"
        ? data.message
        : "Session error";
    return {
      type: "result",
      result: message,
      is_error: true,
    };
  }

  return null;
}

function createCopilotNormalizer(): (
  parsed: unknown,
) => Record<string, unknown> | null {
  const state: CopilotState = {
    accumulatedText: "",
    streamedMessageIds: new Set<string>(),
  };

  return (parsed) => {
    const obj = toObject(parsed);
    if (!obj || typeof obj.type !== "string") return null;
    const data = toObject(obj.data);

    if (obj.type === "assistant.message_delta") {
      return normalizeCopilotMessageDelta(data, state);
    }
    if (obj.type === "assistant.message") {
      return normalizeCopilotAssistantMessage(data, state);
    }
    if (obj.type === "user_input.requested") {
      return normalizeCopilotUserInput(data);
    }
    return normalizeCopilotSessionEvent(
      obj,
      state.accumulatedText,
    );
  };
}

// ── Codex normalizer ────────────────────────────────────────

function normalizeCodexItemCompleted(
  item: Record<string, unknown>,
  accumulatedText: { value: string },
): Record<string, unknown> | null {
  if (item.type === "agent_message") {
    const text = typeof item.text === "string" ? item.text : "";
    accumulatedText.value +=
      (accumulatedText.value ? "\n" : "") + text;
    return {
      type: "assistant",
      message: { content: [{ type: "text", text }] },
    };
  }

  if (item.type === "reasoning") {
    const text = typeof item.text === "string" ? item.text : "";
    return {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text },
      },
    };
  }

  if (item.type === "command_execution") {
    const output =
      typeof item.aggregated_output === "string"
        ? item.aggregated_output
        : "";
    return {
      type: "user",
      message: {
        content: [{ type: "tool_result", content: output }],
      },
    };
  }

  return null;
}

function createCodexNormalizer(
): (parsed: unknown) => Record<string, unknown> | null {
  const accumulatedText = { value: "" };

  return (parsed) => {
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    const type = obj.type;

    if (type === "thread.started" || type === "turn.started") {
      return null;
    }

    if (type === "item.completed") {
      const item = obj.item as Record<string, unknown> | undefined;
      if (!item) return null;
      return normalizeCodexItemCompleted(item, accumulatedText);
    }

    if (type === "item.started") {
      const item = obj.item as Record<string, unknown> | undefined;
      if (item?.type === "command_execution") {
        const cmd =
          typeof item.command === "string" ? item.command : "";
        return {
          type: "assistant",
          message: {
            content: [{
              type: "tool_use",
              name: "Bash",
              input: { command: cmd },
            }],
          },
        };
      }
      return null;
    }

    return normalizeCodexTerminalEvent(obj, accumulatedText.value);
  };
}

function normalizeCodexTerminalEvent(
  obj: Record<string, unknown>,
  accumulatedText: string,
): Record<string, unknown> | null {
  const type = obj.type;

  if (type === "turn.completed") {
    return { type: "result", result: accumulatedText, is_error: false };
  }

  if (type === "turn.failed") {
    const error = obj.error as Record<string, unknown> | undefined;
    const msg =
      typeof error?.message === "string"
        ? error.message
        : "Turn failed";
    return { type: "result", result: msg, is_error: true };
  }

  if (type === "error") {
    const msg =
      typeof obj.message === "string"
        ? obj.message
        : "Unknown error";
    return { type: "result", result: msg, is_error: true };
  }

  return null;
}
