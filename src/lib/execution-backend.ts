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
import { claimKnot, pollKnot, updateKnot } from "@/lib/knots";
import { nextBeat } from "@/lib/beads-state-machine";
import { nextKnot } from "@/lib/knots";
import { wrapExecutionPrompt } from "@/lib/agent-prompt-guardrails";
import { getBeatsSkillPrompt } from "@/lib/beats-skill-prompts";
import {
  ensureKnotsLease,
  logAttachedKnotsLease,
  terminateKnotsRuntimeLease,
} from "@/lib/knots-lease-runtime";
import { resolveMemoryManagerType } from "@/lib/memory-manager-commands";
import { builtinProfileDescriptor, defaultWorkflowDescriptor, forwardTransitionTarget, resolveStep, StepPhase } from "@/lib/workflows";

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
  const workflowList = workflowsResult.ok ? workflowsResult.data ?? [] : [];
  const workflow =
    workflowList.find((candidate) => candidate.id === (beatResult.data!.workflowId ?? beatResult.data!.profileId))
    ?? workflowList[0]
    ?? builtinProfileDescriptor(beatResult.data.profileId ?? beatResult.data.workflowId)
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

export class StructuredExecutionBackend implements ExecutionBackendPort {
  private backend: BackendPort;

  constructor(backend: BackendPort = getBackend()) {
    this.backend = backend;
  }

  async prepareTake(input: PrepareTakeInput): Promise<BackendResult<ExecutionLease>> {
    const snapshotResult = await loadBeatSnapshot(this.backend, input.beatId, input.repoPath);
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
      const prompt = wrapExecutionPrompt([
        `Parent beat ID: ${input.beatId}`,
        `Open child beat IDs:`,
        ...input.childBeatIds.map((id) => `- ${id}`),
        "",
        "Execute child beats in parallel when practical and use the parent beat for context.",
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

    if (memoryManagerType === "knots") {
      const knotsLeaseId = await ensureKnotsLease({
        repoPath: input.repoPath,
        source: "structured_prepare_take",
        executionLeaseId: leaseId,
        beatId: input.beatId,
        interactionType: input.mode,
        agentInfo: input.agentInfo,
      });
      const claimResult = await claimKnot(input.beatId, input.repoPath, {
        agentName: input.agentInfo?.agentName,
        agentModel: input.agentInfo?.agentModel,
        agentVersion: input.agentInfo?.agentVersion,
      });
      if (!claimResult.ok || !claimResult.data) {
        await terminateKnotsRuntimeLease({
          repoPath: input.repoPath,
          source: "structured_prepare_take",
          executionLeaseId: leaseId,
          knotsLeaseId,
          beatId: input.beatId,
          interactionType: input.mode,
          agentInfo: input.agentInfo,
          reason: "prepare_take_claim_failed",
          outcome: "warning",
        });
        return fail(
          claimResult.error ?? `Failed to claim knot ${input.beatId}`,
          "INTERNAL",
          false,
        );
      }

      const claimedSnapshot = await loadBeatSnapshot(this.backend, input.beatId, input.repoPath);
      if (!claimedSnapshot.ok || !claimedSnapshot.data) {
        await terminateKnotsRuntimeLease({
          repoPath: input.repoPath,
          source: "structured_prepare_take",
          executionLeaseId: leaseId,
          knotsLeaseId,
          beatId: input.beatId,
          interactionType: input.mode,
          agentInfo: input.agentInfo,
          reason: "prepare_take_reload_failed",
          outcome: "warning",
        });
        return fail(
          claimedSnapshot.error?.message ?? `Failed to reload beat ${input.beatId}`,
          claimedSnapshot.error?.code ?? "INTERNAL",
          claimedSnapshot.error?.retryable ?? false,
        );
      }

      const lease: ExecutionLease = {
        leaseId,
        mode: input.mode,
        beatId: input.beatId,
        repoPath: input.repoPath,
        beat: claimedSnapshot.data.beat,
        workflow: claimedSnapshot.data.workflow,
        step: claimedSnapshot.data.step,
        prompt: wrapExecutionPrompt(claimResult.data.prompt, "take"),
        claimed: true,
        completion: { kind: "advance", expectedState: claimResult.data.state },
        rollback: { kind: "note", note: "Take iteration failed before completion." },
        agentInfo: input.agentInfo,
        knotsLeaseId,
      };
      leaseStore.set(leaseId, { lease });
      logAttachedKnotsLease({
        repoPath: input.repoPath,
        source: "structured_prepare_take",
        executionLeaseId: leaseId,
        beatId: input.beatId,
        interactionType: input.mode,
        agentInfo: input.agentInfo,
        knotsLeaseId,
      });
      return ok(lease);
    }

    const beat = snapshot.beat;
    const resolved = resolveStep(beat.state);
    if (!resolved || resolved.phase !== StepPhase.Queued || !beat.isAgentClaimable) {
      const prompt = wrapExecutionPrompt([
        `Beat ID: ${input.beatId}`,
        `Use \`bd show "${input.beatId}"\` to inspect full details before starting.`,
      ].join("\n"), "take");
      const lease: ExecutionLease = {
        leaseId,
        mode: input.mode,
        beatId: input.beatId,
        repoPath: input.repoPath,
        beat,
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

    const target = forwardTransitionTarget(beat.state, snapshot.workflow);
    if (!target) {
      return fail(`No forward transition from state '${beat.state}' for beat ${beat.id}`);
    }

    const updateResult = await this.backend.update(beat.id, { state: target }, input.repoPath);
    if (!updateResult.ok) {
      return fail(
        updateResult.error?.message ?? `Failed to claim beat ${beat.id}`,
        updateResult.error?.code ?? "INTERNAL",
        updateResult.error?.retryable ?? false,
      );
    }

    const claimedSnapshot = await loadBeatSnapshot(this.backend, input.beatId, input.repoPath);
    if (!claimedSnapshot.ok || !claimedSnapshot.data) {
      return fail(
        claimedSnapshot.error?.message ?? `Failed to reload beat ${input.beatId}`,
        claimedSnapshot.error?.code ?? "INTERNAL",
        claimedSnapshot.error?.retryable ?? false,
      );
    }

    const claimedStep = resolveStep(target)?.step;
    const lease: ExecutionLease = {
      leaseId,
      mode: input.mode,
      beatId: input.beatId,
      repoPath: input.repoPath,
      beat: claimedSnapshot.data.beat,
      workflow: claimedSnapshot.data.workflow,
      step: claimedSnapshot.data.step,
      prompt: wrapExecutionPrompt(
        claimedStep ? getBeatsSkillPrompt(claimedStep, beat.id, target) : `Beat ID: ${beat.id}`,
        "take",
      ),
      claimed: true,
      completion: { kind: "advance", expectedState: target },
      rollback: { kind: "noop" },
    };
    leaseStore.set(leaseId, { lease });
    return ok(lease);
  }

  async preparePoll(input: PreparePollInput): Promise<BackendResult<PollLeaseResult>> {
    const memoryManagerType = resolveMemoryManagerType(input.repoPath);
    if (memoryManagerType === "knots") {
      const executionLeaseId = generateLeaseId();
      const knotsLeaseId = await ensureKnotsLease({
        repoPath: input.repoPath,
        source: "structured_prepare_poll",
        executionLeaseId,
        interactionType: "poll",
        agentInfo: input.agentInfo,
      });
      const pollResult = await pollKnot(input.repoPath, input.agentInfo);
      if (!pollResult.ok || !pollResult.data) {
        await terminateKnotsRuntimeLease({
          repoPath: input.repoPath,
          source: "structured_prepare_poll",
          executionLeaseId,
          knotsLeaseId,
          interactionType: "poll",
          agentInfo: input.agentInfo,
          reason: "prepare_poll_claim_failed",
          outcome: "warning",
        });
        return fail(pollResult.error ?? "Failed to poll knot");
      }
      const snapshotResult = await loadBeatSnapshot(this.backend, pollResult.data.id, input.repoPath);
      if (!snapshotResult.ok || !snapshotResult.data) {
        await terminateKnotsRuntimeLease({
          repoPath: input.repoPath,
          source: "structured_prepare_poll",
          executionLeaseId,
          knotsLeaseId,
          beatId: pollResult.data.id,
          claimedId: pollResult.data.id,
          interactionType: "poll",
          agentInfo: input.agentInfo,
          reason: "prepare_poll_reload_failed",
          outcome: "warning",
        });
        return fail(
          snapshotResult.error?.message ?? `Failed to load beat ${pollResult.data.id}`,
          snapshotResult.error?.code ?? "INTERNAL",
          snapshotResult.error?.retryable ?? false,
        );
      }
      const lease: ExecutionLease = {
        leaseId: executionLeaseId,
        mode: "poll",
        beatId: pollResult.data.id,
        repoPath: input.repoPath,
        beat: snapshotResult.data.beat,
        workflow: snapshotResult.data.workflow,
        step: snapshotResult.data.step,
        prompt: wrapExecutionPrompt(pollResult.data.prompt, "take"),
        claimed: true,
        completion: { kind: "advance", expectedState: pollResult.data.state },
        rollback: { kind: "note", note: "Poll iteration failed before completion." },
        agentInfo: input.agentInfo,
        knotsLeaseId,
      };
      leaseStore.set(lease.leaseId, { lease });
      logAttachedKnotsLease({
        repoPath: input.repoPath,
        source: "structured_prepare_poll",
        executionLeaseId,
        beatId: pollResult.data.id,
        claimedId: pollResult.data.id,
        interactionType: "poll",
        agentInfo: input.agentInfo,
        knotsLeaseId,
      });
      return ok({ lease, claimedId: pollResult.data.id });
    }

    const readyResult = await this.backend.listReady(undefined, input.repoPath);
    if (!readyResult.ok || !readyResult.data?.length) {
      return fail(readyResult.error?.message ?? "No claimable beats available", "NOT_FOUND");
    }
    const beat = readyResult.data.find((candidate) => candidate.isAgentClaimable);
    if (!beat) return fail("No claimable beats available", "NOT_FOUND");
    const leaseResult = await this.prepareTake({
      beatId: beat.id,
      repoPath: input.repoPath,
      mode: "take",
    });
    if (!leaseResult.ok || !leaseResult.data) {
      return fail(
        leaseResult.error?.message ?? `Failed to prepare take for ${beat.id}`,
        leaseResult.error?.code ?? "INTERNAL",
        leaseResult.error?.retryable ?? false,
      );
    }
    return ok({ lease: leaseResult.data, claimedId: beat.id });
  }

  async completeIteration(input: CompleteIterationInput): Promise<BackendResult<ExecutionSnapshot>> {
    const stored = leaseStore.get(input.leaseId);
    if (!stored) return fail(`Unknown execution lease ${input.leaseId}`, "NOT_FOUND");
    const { lease } = stored;
    if (lease.completion.kind === "advance" && lease.completion.expectedState) {
      const memoryManagerType = resolveMemoryManagerType(lease.repoPath);
      if (memoryManagerType === "knots") {
        const result = await nextKnot(lease.beatId, lease.repoPath, {
          actorKind: "agent",
          expectedState: lease.completion.expectedState,
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

  async getExecutionSnapshot(input: GetExecutionSnapshotInput): Promise<BackendResult<ExecutionSnapshot>> {
    return loadBeatSnapshot(this.backend, input.beatId, input.repoPath);
  }
}
