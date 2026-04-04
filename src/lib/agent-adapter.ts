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
import {
  createGeminiNormalizer,
  createOpenCodeNormalizer,
  createCopilotNormalizer,
  createCodexNormalizer,
} from "@/lib/agent-adapter-normalizers";

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

/**
 * Build CLI args for an interactive Gemini session.
 * Uses `gemini --acp -y` (ACP protocol with yolo).
 */
export function buildGeminiInteractiveArgs(
  agent: RegisteredAgent | AgentTarget,
): PromptModeArgs {
  const command =
    "command" in agent &&
    typeof agent.command === "string"
      ? agent.command
      : "gemini";
  const args = ["--acp", "-y"];
  if (agent.model) {
    args.push("-m", agent.model);
  }
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
