export type AgentTargetKind = "cli";

/**
 * Resolved, dialect-agnostic runtime settings carried on a dispatch target.
 * Populated at dispatch time from the central `agentRuntime` settings (see
 * `attachAgentRuntimeSettings`) for the Codex and Claude dialects only. The
 * arg-builders consume the fields their own dialect supports: Codex reads both
 * `speed` (→ `service_tier`) and `reasoning` (→ `model_reasoning_effort`);
 * Claude reads only `reasoning` (→ `--effort`) and ignores `speed`.
 */
export interface AgentRuntimeTarget {
  speed?: string;
  reasoning?: string;
}

export interface AgentTargetBase {
  kind: AgentTargetKind;
  agent_type?: string;
  vendor?: string;
  provider?: string;
  agent_name?: string;
  lease_model?: string;
  model?: string;
  flavor?: string;
  version?: string;
  approvalMode?: "bypass" | "prompt";
  label?: string;
  agentId?: string;
  /** Central provider runtime settings resolved for this target's dialect. */
  runtime?: AgentRuntimeTarget;
}

export interface CliAgentTarget extends AgentTargetBase {
  kind: "cli";
  command: string;
}

export type AgentTarget = CliAgentTarget;
