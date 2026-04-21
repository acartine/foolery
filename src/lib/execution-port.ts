import type { BackendResult } from "@/lib/backend-port";
import type { Beat, BeatDependency, MemoryWorkflowDescriptor } from "@/lib/types";

export type ExecutionMode = "take" | "scene" | "poll";

export interface ExecutionAgentInfo {
  agentName?: string;
  agentModel?: string;
  agentVersion?: string;
  agentProvider?: string;
  agentType?: string;
}

export interface ExecutionCompletionAction {
  kind: "noop" | "advance";
  expectedState?: string;
}

export interface ExecutionRollbackAction {
  kind: "noop" | "note";
  note?: string;
}

export interface ExecutionLease {
  leaseId: string;
  mode: ExecutionMode;
  beatId: string;
  repoPath?: string;
  beat: Beat;
  workflow: MemoryWorkflowDescriptor;
  /** Action-state name (was WorkflowStep enum). */
  step?: string;
  prompt: string;
  claimed: boolean;
  completion: ExecutionCompletionAction;
  rollback: ExecutionRollbackAction;
  agentInfo?: ExecutionAgentInfo;
  knotsLeaseId?: string;
}

export interface ExecutionSnapshot {
  beat: Beat;
  workflow: MemoryWorkflowDescriptor;
  /** Action-state name (was WorkflowStep enum). */
  step?: string;
  dependencies: BeatDependency[];
  children: Beat[];
}

export interface PrepareTakeInput {
  beatId: string;
  repoPath?: string;
  mode: "take" | "scene";
  childBeatIds?: string[];
  agentInfo?: ExecutionAgentInfo;
}

export interface PreparePollInput {
  repoPath?: string;
  agentInfo?: ExecutionAgentInfo;
}

export interface CompleteIterationInput {
  leaseId: string;
  outcome: "success" | "no_change";
}

export interface RollbackIterationInput {
  leaseId: string;
  reason: string;
}

export interface GetExecutionSnapshotInput {
  beatId: string;
  repoPath?: string;
}

export interface PollLeaseResult {
  lease: ExecutionLease;
  claimedId: string;
}

export interface ExecutionBackendPort {
  prepareTake(
    input: PrepareTakeInput,
  ): Promise<BackendResult<ExecutionLease>>;

  preparePoll(
    input: PreparePollInput,
  ): Promise<BackendResult<PollLeaseResult>>;

  completeIteration(
    input: CompleteIterationInput,
  ): Promise<BackendResult<ExecutionSnapshot>>;

  rollbackIteration(
    input: RollbackIterationInput,
  ): Promise<BackendResult<void>>;

  getExecutionSnapshot(
    input: GetExecutionSnapshotInput,
  ): Promise<BackendResult<ExecutionSnapshot>>;
}
