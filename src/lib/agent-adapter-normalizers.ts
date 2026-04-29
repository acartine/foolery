/**
 * Agent event normalizers — extracted from agent-adapter.ts.
 *
 * Each `create*Normalizer` returns a stateful function that
 * maps a single parsed JSON line from a non-Claude agent
 * stream into the Claude-shaped event the existing parsers
 * expect, or `null` if the event should be skipped.
 */

// ── Shared helper ──────────────────────────────────────

export function toObject(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

// ── Gemini normalizer ──────────────────────────────────

/**
 * Gemini stream-json events:
 *   init      -> skip
 *   message (role:user) -> skip
 *   message (role:assistant, delta:true) -> text
 *   result (status:success|error) -> result
 */
export function createGeminiNormalizer(
): (parsed: unknown) => Record<string, unknown> | null {
  let accumulatedText = "";

  return (parsed) => {
    const obj = toObject(parsed);
    if (!obj || typeof obj.type !== "string") {
      return null;
    }

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

// ── OpenCode normalizer ────────────────────────────────

interface OpenCodeNormalizerState {
  accumulatedText: string;
}

function normalizeOpenCodeText(
  obj: Record<string, unknown>,
  state: OpenCodeNormalizerState,
): Record<string, unknown> {
  const part = obj.part as Record<string, unknown> | undefined;
  const text = typeof part?.text === "string" ? part.text : "";
  state.accumulatedText +=
    (state.accumulatedText ? "\n" : "") + text;
  return {
    type: "assistant",
    message: { content: [{ type: "text", text }] },
  };
}

function normalizeOpenCodeStepFinish(
  obj: Record<string, unknown>,
  state: OpenCodeNormalizerState,
): Record<string, unknown> {
  const part = obj.part as Record<string, unknown> | undefined;
  const reason = typeof part?.reason === "string" ? part.reason : "";
  return {
    type: "result",
    result: state.accumulatedText,
    is_error: reason === "error",
  };
}

function normalizeOpenCodeToolUse(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const id = typeof obj.id === "string" ? obj.id : undefined;
  const name = typeof obj.name === "string" ? obj.name : "tool";
  const input = toObject(obj.input) ?? {};
  return {
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        ...(id ? { id } : {}),
        name,
        input,
      }],
    },
  };
}

function normalizeOpenCodeToolResult(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const toolUseId = typeof obj.tool_use_id === "string"
    ? obj.tool_use_id : undefined;
  const raw = obj.content;
  const content = typeof raw === "string"
    ? raw
    : (raw === undefined || raw === null
      ? "" : JSON.stringify(raw));
  return {
    type: "user",
    message: {
      content: [{
        type: "tool_result",
        ...(toolUseId ? { tool_use_id: toolUseId } : {}),
        content,
      }],
    },
  };
}

function normalizeOpenCodeReasoning(
  obj: Record<string, unknown>,
): Record<string, unknown> | null {
  const text = typeof obj.text === "string" ? obj.text : "";
  if (!text) return null;
  return {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text },
    },
  };
}

function normalizeOpenCodeSessionError(
  obj: Record<string, unknown>,
  state: OpenCodeNormalizerState,
): Record<string, unknown> {
  const message = typeof obj.message === "string"
    ? obj.message
    : "OpenCode session error";
  return {
    type: "result",
    result: state.accumulatedText || message,
    is_error: true,
  };
}

export function createOpenCodeNormalizer(
): (parsed: unknown) => Record<string, unknown> | null {
  const state: OpenCodeNormalizerState = {
    accumulatedText: "",
  };

  return (parsed) => {
    const obj = toObject(parsed);
    if (!obj) return null;
    const type = obj.type;

    if (type === "step_start") return null;
    if (type === "text") return normalizeOpenCodeText(obj, state);
    if (type === "step_finish") {
      return normalizeOpenCodeStepFinish(obj, state);
    }
    if (type === "tool_use") return normalizeOpenCodeToolUse(obj);
    if (type === "tool_result") {
      return normalizeOpenCodeToolResult(obj);
    }
    if (type === "reasoning") {
      return normalizeOpenCodeReasoning(obj);
    }
    if (type === "session_error") {
      return normalizeOpenCodeSessionError(obj, state);
    }
    return null;
  };
}

// ── Copilot normalizer ─────────────────────────────────

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
  if (messageId) {
    state.streamedMessageIds.add(messageId);
  }
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
    if (
      !request || typeof request.name !== "string"
    ) {
      return [];
    }
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
  const blocks =
    collectCopilotToolBlocks(data.toolRequests);

  if (
    content &&
    (!messageId ||
      !state.streamedMessageIds.has(messageId))
  ) {
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
        typeof choice === "string" &&
        choice.trim().length > 0,
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
        input: {
          questions: [{ question, options }],
        },
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

export function createCopilotNormalizer(): (
  parsed: unknown,
) => Record<string, unknown> | null {
  const state: CopilotState = {
    accumulatedText: "",
    streamedMessageIds: new Set<string>(),
  };

  return (parsed) => {
    const obj = toObject(parsed);
    if (!obj || typeof obj.type !== "string") {
      return null;
    }
    const data = toObject(obj.data);

    if (obj.type === "assistant.message_delta") {
      return normalizeCopilotMessageDelta(
        data, state,
      );
    }
    if (obj.type === "assistant.message") {
      return normalizeCopilotAssistantMessage(
        data, state,
      );
    }
    if (obj.type === "user_input.requested") {
      return normalizeCopilotUserInput(data);
    }
    return normalizeCopilotSessionEvent(
      obj, state.accumulatedText,
    );
  };
}

// ── Codex normalizer ───────────────────────────────────

function normalizeCodexItemCompleted(
  item: Record<string, unknown>,
  accumulatedText: { value: string },
): Record<string, unknown> | null {
  if (item.type === "agent_message") {
    const text =
      typeof item.text === "string" ? item.text : "";
    accumulatedText.value +=
      (accumulatedText.value ? "\n" : "") + text;
    return {
      type: "assistant",
      message: {
        content: [{ type: "text", text }],
      },
    };
  }

  if (item.type === "reasoning") {
    const text =
      typeof item.text === "string" ? item.text : "";
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
        content: [
          { type: "tool_result", content: output },
        ],
      },
    };
  }

  return null;
}

function normalizeCodexTerminalEvent(
  obj: Record<string, unknown>,
  accumulatedText: string,
): Record<string, unknown> | null {
  const type = obj.type;

  if (type === "turn.completed") {
    return {
      type: "result",
      result: accumulatedText,
      is_error: false,
    };
  }

  if (type === "turn.failed") {
    const error =
      obj.error as Record<string, unknown> | undefined;
    const msg =
      typeof error?.message === "string"
        ? error.message
        : "Turn failed";
    return {
      type: "result", result: msg, is_error: true,
    };
  }

  if (type === "error") {
    const msg =
      typeof obj.message === "string"
        ? obj.message
        : "Unknown error";
    return {
      type: "result", result: msg, is_error: true,
    };
  }

  return null;
}

export function createCodexNormalizer(
): (parsed: unknown) => Record<string, unknown> | null {
  const accumulatedText = { value: "" };

  return (parsed) => {
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    const type = obj.type;

    if (
      type === "thread.started" ||
      type === "turn.started"
    ) {
      return null;
    }

    if (type === "item.completed") {
      const item =
        obj.item as
          Record<string, unknown> | undefined;
      if (!item) return null;
      return normalizeCodexItemCompleted(
        item, accumulatedText,
      );
    }

    if (type === "item.started") {
      const item =
        obj.item as
          Record<string, unknown> | undefined;
      if (item?.type === "command_execution") {
        const cmd =
          typeof item.command === "string"
            ? item.command : "";
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

    return normalizeCodexTerminalEvent(
      obj, accumulatedText.value,
    );
  };
}
