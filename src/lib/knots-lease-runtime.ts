import type { ExecutionAgentInfo } from "@/lib/execution-port";
import { createLease, terminateLease } from "@/lib/knots";
import { logLeaseAudit } from "@/lib/lease-audit";

export type KnotsLeaseRuntimeSource =
  | "terminal_manager_take"
  | "structured_prepare_take"
  | "structured_prepare_poll"
  | "structured_complete_iteration"
  | "structured_rollback_iteration"
  | "doctor_active_leases";

export interface EnsureKnotsLeaseInput {
  repoPath?: string;
  source: KnotsLeaseRuntimeSource;
  sessionId?: string;
  executionLeaseId?: string;
  beatId?: string;
  claimedId?: string;
  interactionType?: string;
  agentInfo?: ExecutionAgentInfo;
}

export interface TerminateKnotsLeaseInput extends EnsureKnotsLeaseInput {
  knotsLeaseId: string;
  reason: string;
  outcome?: "success" | "warning" | "error";
  data?: Record<string, unknown>;
}

function leaseNickname(input: EnsureKnotsLeaseInput): string {
  return [
    "foolery",
    input.source,
    input.sessionId ?? input.executionLeaseId ?? input.beatId ?? "runtime",
  ]
    .filter(Boolean)
    .join(":")
    .slice(0, 120);
}

function baseAuditData(input: EnsureKnotsLeaseInput | TerminateKnotsLeaseInput): Omit<
  EnsureKnotsLeaseInput,
  "source"
> & { interactionType?: string } {
  return {
    repoPath: input.repoPath,
    sessionId: input.sessionId,
    executionLeaseId: input.executionLeaseId,
    beatId: input.beatId,
    claimedId: input.claimedId,
    interactionType: input.interactionType,
    agentInfo: input.agentInfo,
  };
}

export async function ensureKnotsLease(
  input: EnsureKnotsLeaseInput,
): Promise<string> {
  const auditBase = baseAuditData(input);
  void logLeaseAudit({
    event: "lease_create_requested",
    repoPath: input.repoPath,
    sessionId: input.sessionId,
    executionLeaseId: input.executionLeaseId,
    beatId: input.beatId,
    claimedId: input.claimedId,
    interactionType: input.interactionType ?? input.source,
    agentName: input.agentInfo?.agentName,
    agentProvider: input.agentInfo?.agentProvider,
    agentModel: input.agentInfo?.agentModel,
    agentVersion: input.agentInfo?.agentVersion,
    outcome: "success",
    message: `Requesting Knots lease for ${input.source}.`,
    data: { source: input.source, nickname: leaseNickname(input) },
  });

  const result = await createLease(
    {
      nickname: leaseNickname(input),
      type: "agent",
      agentName: input.agentInfo?.agentName,
      model: input.agentInfo?.agentModel,
      modelVersion: input.agentInfo?.agentVersion,
      provider: input.agentInfo?.agentProvider,
      agentType: input.agentInfo?.agentType,
    },
    input.repoPath,
  );

  if (!result.ok || !result.data?.id) {
    const errorMsg =
      `Failed to create Knots lease for ${input.source}: ` +
      `${result.error ?? "unknown"}`;
    void logLeaseAudit({
      event: "lease_create_failed",
      repoPath: input.repoPath,
      sessionId: input.sessionId,
      executionLeaseId: input.executionLeaseId,
      beatId: input.beatId,
      claimedId: input.claimedId,
      interactionType: input.interactionType ?? input.source,
      agentName: input.agentInfo?.agentName,
      agentProvider: input.agentInfo?.agentProvider,
      agentModel: input.agentInfo?.agentModel,
      agentVersion: input.agentInfo?.agentVersion,
      outcome: "error",
      message: errorMsg,
      data: {
        ...auditBase,
        source: input.source,
        error: result.error ?? "unknown",
      },
    });
    throw new Error(errorMsg);
  }

  void logLeaseAudit({
    event: "lease_create_succeeded",
    repoPath: input.repoPath,
    sessionId: input.sessionId,
    executionLeaseId: input.executionLeaseId,
    knotsLeaseId: result.data.id,
    beatId: input.beatId,
    claimedId: input.claimedId,
    interactionType: input.interactionType ?? input.source,
    agentName: input.agentInfo?.agentName,
    agentProvider: input.agentInfo?.agentProvider,
    agentModel: input.agentInfo?.agentModel,
    agentVersion: input.agentInfo?.agentVersion,
    outcome: "success",
    message: `Created Knots lease ${result.data.id} for ${input.source}.`,
    data: {
      ...auditBase,
      source: input.source,
      lease: result.data.lease ?? null,
    },
  });

  return result.data.id;
}

export async function terminateKnotsRuntimeLease(
  input: TerminateKnotsLeaseInput,
): Promise<void> {
  void logLeaseAudit({
    event: "lease_terminate_requested",
    repoPath: input.repoPath,
    sessionId: input.sessionId,
    executionLeaseId: input.executionLeaseId,
    knotsLeaseId: input.knotsLeaseId,
    beatId: input.beatId,
    claimedId: input.claimedId,
    interactionType: input.interactionType ?? input.source,
    agentName: input.agentInfo?.agentName,
    agentProvider: input.agentInfo?.agentProvider,
    agentModel: input.agentInfo?.agentModel,
    agentVersion: input.agentInfo?.agentVersion,
    outcome: "success",
    message: `Terminating Knots lease ${input.knotsLeaseId} for ${input.source}.`,
    data: {
      reason: input.reason,
      source: input.source,
      ...(input.data ?? {}),
    },
  });

  const result = await terminateLease(input.knotsLeaseId, input.repoPath);
  if (!result.ok) {
    void logLeaseAudit({
      event: "lease_terminate_failed",
      repoPath: input.repoPath,
      sessionId: input.sessionId,
      executionLeaseId: input.executionLeaseId,
      knotsLeaseId: input.knotsLeaseId,
      beatId: input.beatId,
      claimedId: input.claimedId,
      interactionType: input.interactionType ?? input.source,
      agentName: input.agentInfo?.agentName,
      agentProvider: input.agentInfo?.agentProvider,
      agentModel: input.agentInfo?.agentModel,
      agentVersion: input.agentInfo?.agentVersion,
      outcome: input.outcome ?? "warning",
      message: `Failed to terminate Knots lease ${input.knotsLeaseId} for ${input.source}.`,
      data: {
        reason: input.reason,
        source: input.source,
        error: result.error ?? "unknown",
        ...(input.data ?? {}),
      },
    });
    return;
  }

  void logLeaseAudit({
    event: "lease_terminate_succeeded",
    repoPath: input.repoPath,
    sessionId: input.sessionId,
    executionLeaseId: input.executionLeaseId,
    knotsLeaseId: input.knotsLeaseId,
    beatId: input.beatId,
    claimedId: input.claimedId,
    interactionType: input.interactionType ?? input.source,
    agentName: input.agentInfo?.agentName,
    agentProvider: input.agentInfo?.agentProvider,
    agentModel: input.agentInfo?.agentModel,
    agentVersion: input.agentInfo?.agentVersion,
    outcome: "success",
    message: `Terminated Knots lease ${input.knotsLeaseId} for ${input.source}.`,
    data: {
      reason: input.reason,
      source: input.source,
      ...(input.data ?? {}),
    },
  });
}

export function logAttachedKnotsLease(
  input: EnsureKnotsLeaseInput & { knotsLeaseId: string },
): void {
  void logLeaseAudit({
    event: "lease_attached",
    repoPath: input.repoPath,
    sessionId: input.sessionId,
    executionLeaseId: input.executionLeaseId,
    knotsLeaseId: input.knotsLeaseId,
    beatId: input.beatId,
    claimedId: input.claimedId,
    interactionType: input.interactionType ?? input.source,
    agentName: input.agentInfo?.agentName,
    agentModel: input.agentInfo?.agentModel,
    agentVersion: input.agentInfo?.agentVersion,
    outcome: "success",
    message: `Attached Knots lease ${input.knotsLeaseId} to ${input.source}.`,
    data: {
      source: input.source,
    },
  });
}
