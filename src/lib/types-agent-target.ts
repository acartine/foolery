export type AgentTargetKind = "cli";

export interface AgentTargetBase {
  kind: AgentTargetKind;
  model?: string;
  flavor?: string;
  version?: string;
  label?: string;
  agentId?: string;
}

export interface CliAgentTarget extends AgentTargetBase {
  kind: "cli";
  command: string;
}

export type AgentTarget = CliAgentTarget;
