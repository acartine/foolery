/**
 * Free-standing helper functions for StructuredExecutionBackend.
 *
 * Extracted to keep execution-backend.ts under 500 lines.
 */

import type {
  BackendResult,
  BackendPort,
} from "@/lib/backend-port";
import type {
  ExecutionLease,
  ExecutionSnapshot,
  PollLeaseResult,
  PreparePollInput,
  PrepareTakeInput,
} from "@/lib/execution-port";
import { claimKnot, pollKnot } from "@/lib/knots";
import { wrapExecutionPrompt } from "@/lib/agent-prompt-guardrails";
import { getBeatsSkillPrompt } from "@/lib/beats-skill-prompts";
import {
  ensureKnotsLease,
  logAttachedKnotsLease,
  terminateKnotsRuntimeLease,
} from "@/lib/knots-lease-runtime";
import { logLeaseAudit } from "@/lib/lease-audit";
import {
  forwardTransitionTarget,
  resolveStep,
  StepPhase,
} from "@/lib/workflows";

// ── Shared utilities (duplicated thin wrappers) ──────────────

function ok<T>(data: T): BackendResult<T> {
  return { ok: true, data };
}

function fail<T>(
  message: string,
  code = "INTERNAL",
  retryable = false,
): BackendResult<T> {
  return {
    ok: false,
    error: { code, message, retryable },
  };
}

function generateLeaseId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `lease-${Date.now()}-${rand}`;
}

// ── Snapshot loader type ─────────────────────────────────────

// Passed in from execution-backend to avoid circular imports.
type LoadSnapshotFn = (
  backend: BackendPort,
  beatId: string,
  repoPath?: string,
) => Promise<BackendResult<ExecutionSnapshot>>;

// ── prepareTakeKnots ─────────────────────────────────────────

export async function prepareTakeKnots(
  backend: BackendPort,
  input: PrepareTakeInput,
  snapshot: ExecutionSnapshot,
  leaseId: string,
  loadSnapshot: LoadSnapshotFn,
): Promise<BackendResult<ExecutionLease>> {
  let knotsLeaseId: string;
  try {
    knotsLeaseId = await ensureKnotsLease({
      repoPath: input.repoPath,
      source: "structured_prepare_take",
      executionLeaseId: leaseId,
      beatId: input.beatId,
      interactionType: input.mode,
      agentInfo: input.agentInfo,
    });
  } catch (err) {
    return fail(
      err instanceof Error
        ? err.message
        : "Failed to create Knots lease",
    );
  }
  const claimResult = await claimKnot(
    input.beatId, input.repoPath, {
      leaseId: knotsLeaseId,
    },
  );
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
      claimResult.error
        ?? `Failed to claim knot ${input.beatId}`,
      "INTERNAL",
      false,
    );
  }

  return finalizeTakeKnots(
    backend, input, leaseId, knotsLeaseId,
    claimResult.data, loadSnapshot,
  );
}

async function finalizeTakeKnots(
  backend: BackendPort,
  input: PrepareTakeInput,
  leaseId: string,
  knotsLeaseId: string,
  claimData: { prompt: string; state: string },
  loadSnapshot: LoadSnapshotFn,
): Promise<BackendResult<ExecutionLease>> {
  const snap = await loadSnapshot(
    backend, input.beatId, input.repoPath,
  );
  if (!snap.ok || !snap.data) {
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
      snap.error?.message
        ?? `Failed to reload beat ${input.beatId}`,
      snap.error?.code ?? "INTERNAL",
      snap.error?.retryable ?? false,
    );
  }

  const lease: ExecutionLease = {
    leaseId,
    mode: input.mode,
    beatId: input.beatId,
    repoPath: input.repoPath,
    beat: snap.data.beat,
    workflow: snap.data.workflow,
    step: snap.data.step,
    prompt: wrapExecutionPrompt(claimData.prompt, "take"),
    claimed: true,
    completion: {
      kind: "advance",
      expectedState: claimData.state,
    },
    rollback: {
      kind: "note",
      note: "Take iteration failed before completion.",
    },
    agentInfo: input.agentInfo,
    knotsLeaseId,
  };
  logAttachedKnotsLease({
    repoPath: input.repoPath,
    source: "structured_prepare_take",
    executionLeaseId: leaseId,
    beatId: input.beatId,
    interactionType: input.mode,
    agentInfo: input.agentInfo,
    knotsLeaseId,
  });
  void logLeaseAudit({
    event: "prompt_delivered",
    repoPath: input.repoPath,
    executionLeaseId: leaseId,
    knotsLeaseId,
    beatId: input.beatId,
    interactionType: input.mode,
    agentName: input.agentInfo?.agentName,
    agentModel: input.agentInfo?.agentModel,
    agentVersion: input.agentInfo?.agentVersion,
    outcome: "success",
    message:
      `Execution prompt includes lease ` +
      `${knotsLeaseId} for ${input.beatId}.`,
    data: {
      source: "structured_prepare_take",
      promptLength: claimData.prompt.length,
      hasLeaseInPrompt:
        claimData.prompt.includes("--lease"),
    },
  });
  return ok(lease);
}

// ── prepareTakeBeads ─────────────────────────────────────────

export async function prepareTakeBeads(
  backend: BackendPort,
  input: PrepareTakeInput,
  snapshot: ExecutionSnapshot,
  leaseId: string,
  loadSnapshot: LoadSnapshotFn,
): Promise<BackendResult<ExecutionLease>> {
  const beat = snapshot.beat;
  const resolved = resolveStep(beat.state, snapshot.workflow);
  const notClaimable =
    !resolved
    || resolved.phase !== StepPhase.Queued
    || !beat.isAgentClaimable;

  if (notClaimable) {
    return buildUnclaimedBeadsLease(
      input, snapshot, leaseId,
    );
  }

  const target = forwardTransitionTarget(
    beat.state, snapshot.workflow,
  );
  if (!target) {
    return fail(
      `No forward transition from state '${beat.state}'`
      + ` for beat ${beat.id}`,
    );
  }

  return claimAndBuildBeadsLease(
    backend, input, target, leaseId, loadSnapshot,
  );
}

function buildUnclaimedBeadsLease(
  input: PrepareTakeInput,
  snapshot: ExecutionSnapshot,
  leaseId: string,
): BackendResult<ExecutionLease> {
  const prompt = wrapExecutionPrompt([
    `Beat ID: ${input.beatId}`,
    `Use \`bd show "${input.beatId}"\``
      + ` to inspect full details before starting.`,
  ].join("\n"), "take");
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
  return ok(lease);
}

async function claimAndBuildBeadsLease(
  backend: BackendPort,
  input: PrepareTakeInput,
  target: string,
  leaseId: string,
  loadSnapshot: LoadSnapshotFn,
): Promise<BackendResult<ExecutionLease>> {
  const updateResult = await backend.update(
    input.beatId, { state: target }, input.repoPath,
  );
  if (!updateResult.ok) {
    return fail(
      updateResult.error?.message
        ?? `Failed to claim beat ${input.beatId}`,
      updateResult.error?.code ?? "INTERNAL",
      updateResult.error?.retryable ?? false,
    );
  }

  const snap = await loadSnapshot(
    backend, input.beatId, input.repoPath,
  );
  if (!snap.ok || !snap.data) {
    return fail(
      snap.error?.message
        ?? `Failed to reload beat ${input.beatId}`,
      snap.error?.code ?? "INTERNAL",
      snap.error?.retryable ?? false,
    );
  }

  const claimedStep = resolveStep(target, snap.data.workflow)?.step;
  const promptText = claimedStep
    ? getBeatsSkillPrompt(claimedStep, input.beatId, target)
    : `Beat ID: ${input.beatId}`;
  const lease: ExecutionLease = {
    leaseId,
    mode: input.mode,
    beatId: input.beatId,
    repoPath: input.repoPath,
    beat: snap.data.beat,
    workflow: snap.data.workflow,
    step: snap.data.step,
    prompt: wrapExecutionPrompt(promptText, "take"),
    claimed: true,
    completion: { kind: "advance", expectedState: target },
    rollback: { kind: "noop" },
  };
  return ok(lease);
}

// ── preparePollKnots ─────────────────────────────────────────

export async function preparePollKnots(
  backend: BackendPort,
  input: PreparePollInput,
  loadSnapshot: LoadSnapshotFn,
): Promise<BackendResult<PollLeaseResult>> {
  const executionLeaseId = generateLeaseId();
  let knotsLeaseId: string;
  try {
    knotsLeaseId = await ensureKnotsLease({
      repoPath: input.repoPath,
      source: "structured_prepare_poll",
      executionLeaseId,
      interactionType: "poll",
      agentInfo: input.agentInfo,
    });
  } catch (err) {
    return fail(
      err instanceof Error
        ? err.message
        : "Failed to create Knots lease",
    );
  }
  const pollResult = await pollKnot(
    input.repoPath, {
      leaseId: knotsLeaseId,
    },
  );
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
    return fail(
      pollResult.error ?? "Failed to poll knot",
    );
  }

  return finalizePollKnots(
    backend, input, executionLeaseId,
    knotsLeaseId, pollResult.data, loadSnapshot,
  );
}

async function finalizePollKnots(
  backend: BackendPort,
  input: PreparePollInput,
  executionLeaseId: string,
  knotsLeaseId: string,
  pollData: { id: string; prompt: string; state: string },
  loadSnapshot: LoadSnapshotFn,
): Promise<BackendResult<PollLeaseResult>> {
  const snap = await loadSnapshot(
    backend, pollData.id, input.repoPath,
  );
  if (!snap.ok || !snap.data) {
    await terminateKnotsRuntimeLease({
      repoPath: input.repoPath,
      source: "structured_prepare_poll",
      executionLeaseId,
      knotsLeaseId,
      beatId: pollData.id,
      claimedId: pollData.id,
      interactionType: "poll",
      agentInfo: input.agentInfo,
      reason: "prepare_poll_reload_failed",
      outcome: "warning",
    });
    return fail(
      snap.error?.message
        ?? `Failed to load beat ${pollData.id}`,
      snap.error?.code ?? "INTERNAL",
      snap.error?.retryable ?? false,
    );
  }
  const lease: ExecutionLease = {
    leaseId: executionLeaseId,
    mode: "poll",
    beatId: pollData.id,
    repoPath: input.repoPath,
    beat: snap.data.beat,
    workflow: snap.data.workflow,
    step: snap.data.step,
    prompt: wrapExecutionPrompt(pollData.prompt, "take"),
    claimed: true,
    completion: {
      kind: "advance",
      expectedState: pollData.state,
    },
    rollback: {
      kind: "note",
      note: "Poll iteration failed before completion.",
    },
    agentInfo: input.agentInfo,
    knotsLeaseId,
  };
  logAttachedKnotsLease({
    repoPath: input.repoPath,
    source: "structured_prepare_poll",
    executionLeaseId,
    beatId: pollData.id,
    claimedId: pollData.id,
    interactionType: "poll",
    agentInfo: input.agentInfo,
    knotsLeaseId,
  });
  void logLeaseAudit({
    event: "prompt_delivered",
    repoPath: input.repoPath,
    executionLeaseId,
    knotsLeaseId,
    beatId: pollData.id,
    claimedId: pollData.id,
    interactionType: "poll",
    agentName: input.agentInfo?.agentName,
    agentModel: input.agentInfo?.agentModel,
    agentVersion: input.agentInfo?.agentVersion,
    outcome: "success",
    message:
      `Poll prompt includes lease ` +
      `${knotsLeaseId} for ${pollData.id}.`,
    data: {
      source: "structured_prepare_poll",
      promptLength: pollData.prompt.length,
      hasLeaseInPrompt:
        pollData.prompt.includes("--lease"),
    },
  });
  return ok({ lease, claimedId: pollData.id });
}

// ── preparePollBeads ─────────────────────────────────────────

type PrepareTakeFn = (
  input: PrepareTakeInput,
) => Promise<BackendResult<ExecutionLease>>;

export async function preparePollBeads(
  backend: BackendPort,
  input: PreparePollInput,
  prepareTakeFn: PrepareTakeFn,
): Promise<BackendResult<PollLeaseResult>> {
  const readyResult = await backend.listReady(
    undefined, input.repoPath,
  );
  if (!readyResult.ok || !readyResult.data?.length) {
    return fail(
      readyResult.error?.message
        ?? "No claimable beats available",
      "NOT_FOUND",
    );
  }
  const beat = readyResult.data.find(
    (candidate) => candidate.isAgentClaimable,
  );
  if (!beat) {
    return fail("No claimable beats available", "NOT_FOUND");
  }
  const leaseResult = await prepareTakeFn({
    beatId: beat.id,
    repoPath: input.repoPath,
    mode: "take",
  });
  if (!leaseResult.ok || !leaseResult.data) {
    return fail(
      leaseResult.error?.message
        ?? `Failed to prepare take for ${beat.id}`,
      leaseResult.error?.code ?? "INTERNAL",
      leaseResult.error?.retryable ?? false,
    );
  }
  return ok({ lease: leaseResult.data, claimedId: beat.id });
}
