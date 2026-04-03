/**
 * Agent session capability declarations.
 *
 * Each agent dialect declares its capabilities so the
 * shared runtime can adapt behavior without branching
 * on dialect names.
 */

import type { AgentDialect } from "@/lib/agent-adapter";

// ── Capability enum types ──────────────────────────────

/** How the agent accepts prompts. */
export type PromptTransport =
  | "stdin-stream-json"
  | "jsonrpc-stdio"
  | "http-server"
  | "cli-arg";

/** How a completed turn/result is detected. */
export type ResultDetection =
  | "type-result"
  | "type-step_finish"
  | "status-result";

/**
 * When and how stdin should be closed after a result
 * is observed.
 */
export type StdinDrainPolicy =
  | "close-after-result"
  | "never-opened";

// ── Capability interface ───────────────────────────────

export interface AgentSessionCapabilities {
  /** Whether the agent supports interactive stdin. */
  interactive: boolean;
  /** How the agent receives prompts. */
  promptTransport: PromptTransport;
  /** Whether follow-up prompts can be sent. */
  supportsFollowUp: boolean;
  /** Whether AskUser auto-response should be sent. */
  supportsAskUserAutoResponse: boolean;
  /** How a turn result is detected in the stream. */
  resultDetection: ResultDetection;
  /** How stdin should be handled after result. */
  stdinDrainPolicy: StdinDrainPolicy;
  /**
   * Inactivity watchdog timeout in ms.
   * Null means no watchdog.
   */
  watchdogTimeoutMs: number | null;
}

// ── Capability resolution ──────────────────────────────

const CAPABILITIES: Record<
  AgentDialect,
  AgentSessionCapabilities
> = {
  claude: {
    interactive: true,
    promptTransport: "stdin-stream-json",
    supportsFollowUp: true,
    supportsAskUserAutoResponse: true,
    resultDetection: "type-result",
    stdinDrainPolicy: "close-after-result",
    watchdogTimeoutMs: null,
  },
  codex: {
    interactive: false,
    promptTransport: "cli-arg",
    supportsFollowUp: false,
    supportsAskUserAutoResponse: false,
    resultDetection: "type-result",
    stdinDrainPolicy: "never-opened",
    watchdogTimeoutMs: null,
  },
  copilot: {
    interactive: false,
    promptTransport: "cli-arg",
    supportsFollowUp: false,
    supportsAskUserAutoResponse: true,
    resultDetection: "type-result",
    stdinDrainPolicy: "never-opened",
    watchdogTimeoutMs: null,
  },
  opencode: {
    interactive: false,
    promptTransport: "cli-arg",
    supportsFollowUp: false,
    supportsAskUserAutoResponse: false,
    resultDetection: "type-result",
    stdinDrainPolicy: "never-opened",
    watchdogTimeoutMs: null,
  },
  gemini: {
    interactive: false,
    promptTransport: "cli-arg",
    supportsFollowUp: false,
    supportsAskUserAutoResponse: false,
    resultDetection: "status-result",
    stdinDrainPolicy: "never-opened",
    watchdogTimeoutMs: null,
  },
};

/** Interactive Codex capabilities (app-server). */
const CODEX_INTERACTIVE: AgentSessionCapabilities = {
  interactive: true,
  promptTransport: "jsonrpc-stdio",
  supportsFollowUp: true,
  supportsAskUserAutoResponse: false,
  resultDetection: "type-result",
  stdinDrainPolicy: "close-after-result",
  watchdogTimeoutMs: 30_000,
};

/** Interactive Copilot capabilities (session mode). */
const COPILOT_INTERACTIVE: AgentSessionCapabilities = {
  interactive: true,
  promptTransport: "stdin-stream-json",
  supportsFollowUp: true,
  supportsAskUserAutoResponse: true,
  resultDetection: "type-result",
  stdinDrainPolicy: "close-after-result",
  watchdogTimeoutMs: 30_000,
};

/** Interactive OpenCode capabilities (serve mode). */
const OPENCODE_INTERACTIVE: AgentSessionCapabilities = {
  interactive: true,
  promptTransport: "http-server",
  supportsFollowUp: true,
  supportsAskUserAutoResponse: false,
  resultDetection: "type-result",
  stdinDrainPolicy: "close-after-result",
  watchdogTimeoutMs: 30_000,
};

/** Interactive presets keyed by dialect. */
const INTERACTIVE_PRESETS: Partial<
  Record<AgentDialect, AgentSessionCapabilities>
> = {
  codex: CODEX_INTERACTIVE,
  copilot: COPILOT_INTERACTIVE,
  opencode: OPENCODE_INTERACTIVE,
};

/**
 * Resolve capabilities for a given dialect.
 * Falls back to claude defaults for unknown dialects.
 *
 * When `interactive` is true and the dialect has an
 * interactive preset, returns that preset instead of
 * the one-shot default.
 */
export function resolveCapabilities(
  dialect: AgentDialect,
  interactive?: boolean,
): AgentSessionCapabilities {
  if (interactive) {
    const preset = INTERACTIVE_PRESETS[dialect];
    if (preset) return preset;
  }
  return CAPABILITIES[dialect] ?? CAPABILITIES.claude;
}

/**
 * Returns true if the dialect supports interactive
 * sessions (has an interactive preset).
 */
export function supportsInteractive(
  dialect: AgentDialect,
): boolean {
  return dialect in INTERACTIVE_PRESETS;
}
