export type AgentTargetKind = "cli" | "openrouter";

export interface AgentTargetBase {
  kind: AgentTargetKind;
  model?: string;
  version?: string;
  label?: string;
  agentId?: string;
}

export interface CliAgentTarget extends AgentTargetBase {
  kind: "cli";
  command: string;
}

export interface OpenRouterAgentTarget extends AgentTargetBase {
  kind: "openrouter";
  provider: "openrouter";
  authSource: "settings";
  model: string;
  command?: string;
}

export type AgentTarget = CliAgentTarget | OpenRouterAgentTarget;
