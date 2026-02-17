/**
 * Agent adapter — encapsulates CLI dialect differences between Claude Code and Codex.
 *
 * Three responsibilities:
 *   1. Dialect resolution  — detect agent CLI type from command name
 *   2. Arg building        — construct correct CLI args per dialect
 *   3. Event normalization — convert Codex JSONL events to the Claude shapes
 *                            that orchestration/breakdown/terminal parsers expect
 */

import type { RegisteredAgent } from "@/lib/types";

// ── Types ───────────────────────────────────────────────────

export type AgentDialect = "claude" | "codex";

export interface PromptModeArgs {
  command: string;
  args: string[];
}

// ── 1) Dialect resolution ───────────────────────────────────

/**
 * Determine CLI dialect from a command string.
 * Any path or name containing "codex" → codex; everything else → claude.
 */
export function resolveDialect(command: string): AgentDialect {
  const base = command.includes("/")
    ? command.slice(command.lastIndexOf("/") + 1)
    : command;
  return base.toLowerCase().includes("codex") ? "codex" : "claude";
}

// ── 2) Arg building ────────────────────────────────────────

/**
 * Build CLI args for a one-shot prompt invocation (orchestration / breakdown).
 *
 * | Concern            | Claude                                    | Codex                                         |
 * |--------------------|-------------------------------------------|-----------------------------------------------|
 * | Subcommand         | (none)                                    | exec                                          |
 * | Prompt             | -p <prompt>                               | positional arg after exec                     |
 * | JSONL output       | --output-format stream-json               | --json                                        |
 * | Skip approvals     | --dangerously-skip-permissions            | --dangerously-bypass-approvals-and-sandbox    |
 * | Streaming detail   | --include-partial-messages --verbose      | (not needed)                                  |
 * | Input format       | --input-format text                       | (not needed)                                  |
 * | Model              | --model <m>                               | -m <m>                                        |
 */
export function buildPromptModeArgs(
  agent: RegisteredAgent,
  prompt: string,
): PromptModeArgs {
  const dialect = resolveDialect(agent.command);

  if (dialect === "codex") {
    const args = [
      "exec",
      prompt,
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
    ];
    if (agent.model) args.push("-m", agent.model);
    return { command: agent.command, args };
  }

  // claude (default)
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
  return { command: agent.command, args };
}

// ── 3) Event normalization ──────────────────────────────────

/**
 * Returns a function that normalizes a single parsed JSON line from the agent's
 * JSONL stream into the Claude-shaped event the existing parsers expect.
 *
 * For "claude" dialect the normalizer is identity (passthrough).
 * For "codex" dialect the normalizer maps Codex events → Claude shapes.
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

  // codex normalizer — accumulates text across item.completed events
  let accumulatedText = "";

  return (parsed) => {
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    const type = obj.type;

    // Skip structural events
    if (type === "thread.started" || type === "turn.started") {
      return null;
    }

    if (type === "item.completed") {
      const item = obj.item as Record<string, unknown> | undefined;
      if (!item) return null;

      if (item.type === "agent_message") {
        const text = typeof item.text === "string" ? item.text : "";
        accumulatedText += (accumulatedText ? "\n" : "") + text;
        return {
          type: "assistant",
          message: {
            content: [{ type: "text", text }],
          },
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

    if (type === "item.started") {
      const item = obj.item as Record<string, unknown> | undefined;
      if (item?.type === "command_execution") {
        const cmd = typeof item.command === "string" ? item.command : "";
        return {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: `[executing] ${cmd}\n` },
          },
        };
      }
      return null;
    }

    if (type === "turn.completed") {
      return {
        type: "result",
        result: accumulatedText,
        is_error: false,
      };
    }

    if (type === "turn.failed") {
      const error = obj.error as Record<string, unknown> | undefined;
      const msg =
        typeof error?.message === "string" ? error.message : "Turn failed";
      return {
        type: "result",
        result: msg,
        is_error: true,
      };
    }

    if (type === "error") {
      const msg =
        typeof obj.message === "string" ? obj.message : "Unknown error";
      return {
        type: "result",
        result: msg,
        is_error: true,
      };
    }

    // Unknown event type — skip
    return null;
  };
}
