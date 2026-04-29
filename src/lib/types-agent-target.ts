export type AgentTargetKind = "cli";

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
}

export interface CliAgentTarget extends AgentTargetBase {
  kind: "cli";
  command: string;
}

export type AgentTarget = CliAgentTarget;
