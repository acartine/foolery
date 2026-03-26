import type { BackendError, BackendResult, BackendPort } from "@/lib/backend-port";
import type {
  CompleteIterationInput,
  ExecutionBackendPort,
  ExecutionLease,
  ExecutionSnapshot,
  GetExecutionSnapshotInput,
  PollLeaseResult,
  PreparePollInput,
  PrepareTakeInput,
  RollbackIterationInput,
} from "@/lib/execution-port";
import { getBackend } from "@/lib/backend-instance";
import { updateKnot } from "@/lib/knots";
import { nextBeat } from "@/lib/beads-state-machine";
import { nextKnot } from "@/lib/knots";
import { wrapExecutionPrompt } from "@/lib/agent-prompt-guardrails";
import {
  terminateKnotsRuntimeLease,
} from "@/lib/knots-lease-runtime";
import { resolveMemoryManagerType } from "@/lib/memory-manager-commands";
import {
  builtinProfileDescriptor,
  defaultWorkflowDescriptor,
  resolveStep,
} from "@/lib/workflows";
import {
  prepareTakeKnots,
  prepareTakeBeads,
  preparePollKnots,
  preparePollBeads,
} from "@/lib/execution-backend-helpers";

function buildError(message: string, code = "INTERNAL", retryable = false): BackendError {
  return { code, message, retryable };
}

function ok<T>(data: T): BackendResult<T> {
  return { ok: true, data };
}

function fail<T>(message: string, code = "INTERNAL", retryable = false): BackendResult<T> {
  return { ok: false, error: buildError(message, code, retryable) };
}

interface LeaseState {
  lease: ExecutionLease;
}

const leaseStore = new Map<string, LeaseState>();

function generateLeaseId(): string {
  return `lease-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadBeatSnapshot(
  backend: BackendPort,
  beatId: string,
  repoPath?: string,
): Promise<BackendResult<ExecutionSnapshot>> {
  const beatResult = await backend.get(beatId, repoPath);
  if (!beatResult.ok || !beatResult.data) {
    return fail(
      beatResult.error?.message ?? `Beat ${beatId} not found`,
      beatResult.error?.code ?? "NOT_FOUND",
      beatResult.error?.retryable ?? false,
    );
  }

  const workflowsResult = await backend.listWorkflows(repoPath);
  const workflowList = workflowsResult.ok
    ? workflowsResult.data ?? []
    : [];
  const beatWfId =
    beatResult.data!.workflowId ?? beatResult.data!.profileId;
  const workflow =
    workflowList.find((c) => c.id === beatWfId)
    ?? workflowList[0]
    ?? builtinProfileDescriptor(
      beatResult.data.profileId ?? beatResult.data.workflowId,
    )
    ?? defaultWorkflowDescriptor();

  const depsResult = await backend.listDependencies(beatId, repoPath);
  const childrenResult = await backend.list({ parent: beatId }, repoPath);
  return ok({
    beat: beatResult.data,
    workflow,
    step: resolveStep(beatResult.data.state)?.step,
    dependencies: depsResult.ok ? depsResult.data ?? [] : [],
    children: childrenResult.ok ? childrenResult.data ?? [] : [],
  });
}

function prepareTakeScene(
  input: PrepareTakeInput,
  snapshot: ExecutionSnapshot,
  leaseId: string,
): BackendResult<ExecutionLease> {
  const prompt = wrapExecutionPrompt([
    `Parent beat ID: ${input.beatId}`,
    `Open child beat IDs:`,
    ...input.childBeatIds!.map((id) => `- ${id}`),
    "",
    "Execute child beats in parallel when practical" +
    " and use the parent beat for context.",
  ].join("\n"), "scene");
  const lease: ExecutionLease = {
    leaseId,
    mode: input.mode,
    beatId: input.beatId,
    repoPath: input.repoPath,
    beat: snapshot.beat,
    workflow: snapshot.workflow,
    step: snapshot.step,
    prompt,
    claimed: false,
    completion: { kind: "noop" },
    rollback: { kind: "noop" },
  };
  leaseStore.set(leaseId, { lease });
  return ok(lease);
}

export class StructuredExecutionBackend implements ExecutionBackendPort {
  private backend: BackendPort;

  constructor(backend: BackendPort = getBackend()) {
    this.backend = backend;
  }

  async prepareTake(
    input: PrepareTakeInput,
  ): Promise<BackendResult<ExecutionLease>> {
    const snapshotResult = await loadBeatSnapshot(
      this.backend, input.beatId, input.repoPath,
    );
    if (!snapshotResult.ok || !snapshotResult.data) {
      return fail(
        snapshotResult.error?.message ?? `Failed to load beat ${input.beatId}`,
        snapshotResult.error?.code ?? "INTERNAL",
        snapshotResult.error?.retryable ?? false,
      );
    }
    const snapshot = snapshotResult.data;
    const memoryManagerType = resolveMemoryManagerType(input.repoPath);
    const leaseId = generateLeaseId();

    if (input.mode === "scene" && input.childBeatIds?.length) {
      return prepareTakeScene(input, snapshot, leaseId);
    }

    if (memoryManagerType === "knots") {
      const result = await prepareTakeKnots(
        this.backend, input, snapshot,
        leaseId, loadBeatSnapshot,
      );
      if (result.ok && result.data) {
        leaseStore.set(leaseId, { lease: result.data });
      }
      return result;
    }

    const result = await prepareTakeBeads(
      this.backend, input, snapshot,
      leaseId, loadBeatSnapshot,
    );
    if (result.ok && result.data) {
      leaseStore.set(leaseId, { lease: result.data });
    }
    return result;
  }

  async preparePoll(
    input: PreparePollInput,
  ): Promise<BackendResult<PollLeaseResult>> {
    const memoryManagerType = resolveMemoryManagerType(
      input.repoPath,
    );
    if (memoryManagerType === "knots") {
      const result = await preparePollKnots(
        this.backend, input, loadBeatSnapshot,
      );
      if (result.ok && result.data) {
        leaseStore.set(
          result.data.lease.leaseId,
          { lease: result.data.lease },
        );
      }
      return result;
    }
    const takeFn = this.prepareTake.bind(this);
    const result = await preparePollBeads(
      this.backend, input, takeFn,
    );
    if (result.ok && result.data) {
      leaseStore.set(
        result.data.lease.leaseId,
        { lease: result.data.lease },
      );
    }
    return result;
  }

  async completeIteration(
    input: CompleteIterationInput,
  ): Promise<BackendResult<ExecutionSnapshot>> {
    const stored = leaseStore.get(input.leaseId);
    if (!stored) return fail(`Unknown execution lease ${input.leaseId}`, "NOT_FOUND");
    const { lease } = stored;
    if (lease.completion.kind === "advance" && lease.completion.expectedState) {
      const memoryManagerType = resolveMemoryManagerType(lease.repoPath);
      if (memoryManagerType === "knots") {
        const result = await nextKnot(lease.beatId, lease.repoPath, {
          actorKind: "agent",
          expectedState: lease.completion.expectedState,
          leaseId: lease.knotsLeaseId,
        });
        if (!result.ok) {
          return fail(result.error ?? `Failed to advance knot ${lease.beatId}`);
        }
      } else {
        await nextBeat(lease.beatId, lease.completion.expectedState, lease.repoPath);
      }
    }
    if (resolveMemoryManagerType(lease.repoPath) === "knots") {
      await terminateKnotsRuntimeLease({
        repoPath: lease.repoPath,
        source: "structured_complete_iteration",
        executionLeaseId: lease.leaseId,
        knotsLeaseId: lease.knotsLeaseId,
        beatId: lease.beatId,
        claimedId: lease.beatId,
        interactionType: lease.mode,
        agentInfo: lease.agentInfo,
        reason: `complete:${input.outcome}`,
      });
    }
    leaseStore.delete(input.leaseId);
    return this.getExecutionSnapshot({ beatId: lease.beatId, repoPath: lease.repoPath });
  }

  async rollbackIteration(input: RollbackIterationInput): Promise<BackendResult<void>> {
    const stored = leaseStore.get(input.leaseId);
    if (!stored) return fail(`Unknown execution lease ${input.leaseId}`, "NOT_FOUND");
    const { lease } = stored;
    if (lease.rollback.kind === "note" && lease.rollback.note) {
      const memoryManagerType = resolveMemoryManagerType(lease.repoPath);
      if (memoryManagerType === "knots") {
        const note = `${lease.rollback.note} Reason: ${input.reason}`;
        const result = await updateKnot(lease.beatId, {
          addNote: note,
          noteAgentname: lease.agentInfo?.agentName,
          noteModel: lease.agentInfo?.agentModel,
          noteVersion: lease.agentInfo?.agentVersion,
        }, lease.repoPath);
        if (!result.ok) {
          return fail(result.error ?? `Failed to record rollback note for ${lease.beatId}`);
        }
      }
    }
    if (resolveMemoryManagerType(lease.repoPath) === "knots") {
      await terminateKnotsRuntimeLease({
        repoPath: lease.repoPath,
        source: "structured_rollback_iteration",
        executionLeaseId: lease.leaseId,
        knotsLeaseId: lease.knotsLeaseId,
        beatId: lease.beatId,
        claimedId: lease.beatId,
        interactionType: lease.mode,
        agentInfo: lease.agentInfo,
        reason: `rollback:${input.reason}`,
      });
    }
    leaseStore.delete(input.leaseId);
    return ok(undefined);
  }

  async getExecutionSnapshot(
    input: GetExecutionSnapshotInput,
  ): Promise<BackendResult<ExecutionSnapshot>> {
    return loadBeatSnapshot(this.backend, input.beatId, input.repoPath);
  }
}
