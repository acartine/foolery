import type { InteractionLog } from "@/lib/interaction-logger";
import type { CliAgentTarget } from "@/lib/types-agent-target";
import type { TerminalSession } from "@/lib/types";
import type { SessionEntry } from "@/lib/terminal-manager-types";
import type { TakeLoopContext } from "@/lib/terminal-manager-take-loop";

export type TakeLoopLifecycleEvent =
  | "prompt_built"
  | "child_spawned"
  | "prompt_send_attempted"
  | "prompt_send_succeeded"
  | "prompt_send_failed"
  | "prompt_delivery_deferred"
  | "prompt_delivery_attempted"
  | "prompt_delivery_succeeded"
  | "prompt_delivery_failed"
  | "stdout_observed"
  | "stderr_observed"
  | "response_logged"
  | "normalized_event_observed"
  | "turn_ended"
  | "take_loop_follow_up_sent"
  | "take_loop_follow_up_skipped_dead_lease"
  | "child_close"
  | "spawn_error"
  | "post_exit_state_observed"
  | "loop_continue"
  | "loop_stop"
  | "session_finish"
  | "lease_release_requested";

export interface TakeLoopIterationTrace {
  iteration: number;
  beatId: string;
  claimedState?: string;
  leaseId?: string;
  agentName?: string;
  agentModel?: string;
  agentVersion?: string;
  agentCommand?: string;
  childPid?: number;
  childSpawnedAt?: string;
  promptLength?: number;
  promptSource?: string;
  promptBuiltAt?: string;
  promptSendAttemptedAt?: string;
  promptSendSucceededAt?: string;
  promptSendFailedAt?: string;
  promptSendFailure?: string;
  promptDeliveryDeferredAt?: string;
  promptDeliveryDeferredReason?: string;
  promptDeliveryAttemptedAt?: string;
  promptDeliverySucceededAt?: string;
  promptDeliveryFailedAt?: string;
  promptDeliveryTransport?: string;
  promptDeliveryFailure?: string;
  firstStdoutAt?: string;
  firstStdoutPreview?: string;
  firstStderrAt?: string;
  firstStderrPreview?: string;
  firstResponseAt?: string;
  firstResponsePreview?: string;
  firstNormalizedEventAt?: string;
  firstNormalizedEventType?: string;
  resultObservedAt?: string;
  resultIsError?: boolean;
  takeLoopFollowUpSentAt?: string;
  childCloseAt?: string;
  childExitCode?: number | null;
  childSignal?: string | null;
  exitReason?: string;
  msSinceLastStdout?: number | null;
  lastEventType?: string | null;
  spawnErrorAt?: string;
  spawnErrorMessage?: string;
  postExitStateObservedAt?: string;
  postExitState?: string;
  loopDecisionAt?: string;
  loopDecision?: string;
  finishSessionAt?: string;
  finishStatus?: string;
  finishExitCode?: number;
  leaseReleaseRequestedAt?: string;
  leaseReleaseReason?: string;
  leaseReleaseOutcome?: string;
  lastEvent?: TakeLoopLifecycleEvent;
  lastEventAt?: string;
}

type TracePatch = Partial<TakeLoopIterationTrace> & {
  iteration?: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function trimPreview(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (!singleLine) return undefined;
  return singleLine.slice(0, 160);
}

function ensureLifecycleMap(
  entry: SessionEntry,
): Map<number, TakeLoopIterationTrace> {
  if (!entry.takeLoopLifecycle) {
    entry.takeLoopLifecycle = new Map();
  }
  return entry.takeLoopLifecycle;
}

function applyEvent(
  trace: TakeLoopIterationTrace,
  event: TakeLoopLifecycleEvent,
  at: string,
): void {
  trace.lastEvent = event;
  trace.lastEventAt = at;

  switch (event) {
    case "prompt_built":
      trace.promptBuiltAt ??= at;
      break;
    case "child_spawned":
      trace.childSpawnedAt ??= at;
      break;
    case "prompt_send_attempted":
      trace.promptSendAttemptedAt ??= at;
      break;
    case "prompt_send_succeeded":
      trace.promptSendSucceededAt ??= at;
      break;
    case "prompt_send_failed":
      trace.promptSendFailedAt ??= at;
      break;
    case "prompt_delivery_deferred":
      trace.promptDeliveryDeferredAt ??= at;
      break;
    case "prompt_delivery_attempted":
      trace.promptDeliveryAttemptedAt ??= at;
      break;
    case "prompt_delivery_succeeded":
      trace.promptDeliverySucceededAt ??= at;
      break;
    case "prompt_delivery_failed":
      trace.promptDeliveryFailedAt ??= at;
      break;
    case "stdout_observed":
      trace.firstStdoutAt ??= at;
      break;
    case "stderr_observed":
      trace.firstStderrAt ??= at;
      break;
    case "response_logged":
      trace.firstResponseAt ??= at;
      break;
    case "normalized_event_observed":
      trace.firstNormalizedEventAt ??= at;
      break;
    case "turn_ended":
      trace.resultObservedAt ??= at;
      break;
    case "take_loop_follow_up_sent":
      trace.takeLoopFollowUpSentAt ??= at;
      break;
    case "child_close":
      trace.childCloseAt ??= at;
      break;
    case "spawn_error":
      trace.spawnErrorAt ??= at;
      break;
    case "post_exit_state_observed":
      trace.postExitStateObservedAt ??= at;
      break;
    case "loop_continue":
    case "loop_stop":
      trace.loopDecisionAt = at;
      break;
    case "session_finish":
      trace.finishSessionAt = at;
      break;
    case "lease_release_requested":
      trace.leaseReleaseRequestedAt = at;
      break;
  }
}

function buildConsoleLine(
  sessionId: string,
  event: TakeLoopLifecycleEvent,
  trace: TakeLoopIterationTrace,
): string {
  const parts = [
    `[terminal-manager] [${sessionId}] [take-loop] [lifecycle]`,
    `event=${event}`,
    `iteration=${trace.iteration}`,
    `beat=${trace.beatId}`,
  ];
  if (trace.claimedState) {
    parts.push(`state=${trace.claimedState}`);
  }
  if (trace.leaseId) {
    parts.push(`lease=${trace.leaseId}`);
  }
  if (trace.agentName) {
    parts.push(`agent=${JSON.stringify(trace.agentName)}`);
  }
  if (trace.childPid !== undefined) {
    parts.push(`pid=${trace.childPid}`);
  }
  if (trace.promptDeliveryTransport) {
    parts.push(
      `transport=${JSON.stringify(
        trace.promptDeliveryTransport,
      )}`,
    );
  }
  if (trace.promptDeliveryFailure) {
    parts.push(
      `delivery_detail=${JSON.stringify(
        trace.promptDeliveryFailure,
      )}`,
    );
  }
  if (trace.loopDecision) {
    parts.push(`decision=${JSON.stringify(trace.loopDecision)}`);
  }
  if (trace.finishStatus) {
    parts.push(`status=${trace.finishStatus}`);
  }
  return parts.join(" ");
}

function logInteractionLifecycle(
  interactionLog: InteractionLog,
  event: TakeLoopLifecycleEvent,
  trace: TakeLoopIterationTrace,
): void {
  interactionLog.logLifecycle?.({
    event,
    beatId: trace.beatId,
    iteration: trace.iteration,
    claimedState: trace.claimedState,
    leaseId: trace.leaseId,
    agentName: trace.agentName,
    agentModel: trace.agentModel,
    agentVersion: trace.agentVersion,
    agentCommand: trace.agentCommand,
    childPid: trace.childPid,
    promptLength: trace.promptLength,
    promptSource: trace.promptSource,
    promptBuiltAt: trace.promptBuiltAt,
    promptSendAttemptedAt: trace.promptSendAttemptedAt,
    promptSendSucceededAt: trace.promptSendSucceededAt,
    promptSendFailedAt: trace.promptSendFailedAt,
    promptSendFailure: trace.promptSendFailure,
    promptDeliveryDeferredAt:
      trace.promptDeliveryDeferredAt,
    promptDeliveryDeferredReason:
      trace.promptDeliveryDeferredReason,
    promptDeliveryAttemptedAt:
      trace.promptDeliveryAttemptedAt,
    promptDeliverySucceededAt:
      trace.promptDeliverySucceededAt,
    promptDeliveryFailedAt:
      trace.promptDeliveryFailedAt,
    promptDeliveryTransport:
      trace.promptDeliveryTransport,
    promptDeliveryFailure:
      trace.promptDeliveryFailure,
    firstStdoutAt: trace.firstStdoutAt,
    firstStdoutPreview: trace.firstStdoutPreview,
    firstStderrAt: trace.firstStderrAt,
    firstStderrPreview: trace.firstStderrPreview,
    firstResponseAt: trace.firstResponseAt,
    firstResponsePreview: trace.firstResponsePreview,
    firstNormalizedEventAt: trace.firstNormalizedEventAt,
    firstNormalizedEventType: trace.firstNormalizedEventType,
    resultObservedAt: trace.resultObservedAt,
    resultIsError: trace.resultIsError,
    childSpawnedAt: trace.childSpawnedAt,
    childCloseAt: trace.childCloseAt,
    childExitCode: trace.childExitCode,
    childSignal: trace.childSignal,
    exitReason: trace.exitReason,
    msSinceLastStdout: trace.msSinceLastStdout,
    lastEventType: trace.lastEventType,
    spawnErrorAt: trace.spawnErrorAt,
    spawnErrorMessage: trace.spawnErrorMessage,
    postExitState: trace.postExitState,
    postExitStateObservedAt:
      trace.postExitStateObservedAt,
    loopDecisionAt: trace.loopDecisionAt,
    loopDecision: trace.loopDecision,
    finishSessionAt: trace.finishSessionAt,
    finishStatus: trace.finishStatus,
    finishExitCode: trace.finishExitCode,
    leaseReleaseRequestedAt: trace.leaseReleaseRequestedAt,
    leaseReleaseReason: trace.leaseReleaseReason,
    leaseReleaseOutcome: trace.leaseReleaseOutcome,
    lastEvent: trace.lastEvent,
    lastEventAt: trace.lastEventAt,
  });
}

function baseTrace(
  ctx: TakeLoopContext,
  iteration: number,
): TakeLoopIterationTrace {
  return {
    iteration,
    beatId: ctx.beatId,
    claimedState: ctx.entry.knotsLeaseStep,
    leaseId: ctx.entry.knotsLeaseId,
    agentName: ctx.agentInfo.agentName,
    agentModel: ctx.agent.model,
    agentVersion: ctx.agent.version,
    agentCommand: ctx.agent.command,
  };
}

export function recordTakeLoopLifecycle(
  ctx: TakeLoopContext,
  event: TakeLoopLifecycleEvent,
  patch: TracePatch = {},
): TakeLoopIterationTrace {
  const iteration =
    patch.iteration ?? ctx.takeIteration.value;
  const map = ensureLifecycleMap(ctx.entry);
  const at = nowIso();
  const trace = map.get(iteration) ?? baseTrace(ctx, iteration);

  Object.assign(trace, {
    ...patch,
    claimedState:
      patch.claimedState ??
      trace.claimedState ??
      ctx.entry.knotsLeaseStep,
    leaseId:
      patch.leaseId ??
      trace.leaseId ??
      ctx.entry.knotsLeaseId,
    agentName:
      patch.agentName ??
      trace.agentName ??
      ctx.agentInfo.agentName,
    agentModel:
      patch.agentModel ??
      trace.agentModel ??
      ctx.agent.model,
    agentVersion:
      patch.agentVersion ??
      trace.agentVersion ??
      ctx.agent.version,
    agentCommand:
      patch.agentCommand ??
      trace.agentCommand ??
      ctx.agent.command,
    firstStdoutPreview:
      trimPreview(patch.firstStdoutPreview) ??
      trace.firstStdoutPreview,
    firstStderrPreview:
      trimPreview(patch.firstStderrPreview) ??
      trace.firstStderrPreview,
    firstResponsePreview:
      trimPreview(patch.firstResponsePreview) ??
      trace.firstResponsePreview,
  });
  applyEvent(trace, event, at);
  map.set(iteration, trace);
  console.log(buildConsoleLine(ctx.id, event, trace));
  logInteractionLifecycle(ctx.interactionLog, event, trace);
  return trace;
}

export function recordSessionFinishLifecycle(
  entry: SessionEntry,
  interactionLog: InteractionLog,
  sessionId: string,
  beatId: string,
  session: TerminalSession,
  exitCode: number,
): void {
  const map = entry.takeLoopLifecycle;
  if (!map || map.size === 0) return;
  const latest = [...map.values()]
    .sort((left, right) => left.iteration - right.iteration)
    .at(-1);
  if (!latest) return;
  latest.finishExitCode = exitCode;
  latest.finishStatus = session.status;
  latest.finishSessionAt = nowIso();
  latest.lastEvent = "session_finish";
  latest.lastEventAt = latest.finishSessionAt;
  console.log(buildConsoleLine(sessionId, "session_finish", latest));
  interactionLog.logLifecycle?.({
    event: "session_finish",
    beatId,
    iteration: latest.iteration,
    finishExitCode: latest.finishExitCode,
    finishStatus: latest.finishStatus,
    finishSessionAt: latest.finishSessionAt,
    claimedState: latest.claimedState,
    leaseId: latest.leaseId,
    agentName: latest.agentName,
    agentModel: latest.agentModel,
    agentVersion: latest.agentVersion,
    agentCommand: latest.agentCommand,
    childPid: latest.childPid,
    promptBuiltAt: latest.promptBuiltAt,
    promptSendAttemptedAt: latest.promptSendAttemptedAt,
    promptSendSucceededAt: latest.promptSendSucceededAt,
    promptSendFailedAt: latest.promptSendFailedAt,
    promptDeliveryDeferredAt:
      latest.promptDeliveryDeferredAt,
    promptDeliveryDeferredReason:
      latest.promptDeliveryDeferredReason,
    promptDeliveryAttemptedAt:
      latest.promptDeliveryAttemptedAt,
    promptDeliverySucceededAt:
      latest.promptDeliverySucceededAt,
    promptDeliveryFailedAt:
      latest.promptDeliveryFailedAt,
    promptDeliveryTransport:
      latest.promptDeliveryTransport,
    promptDeliveryFailure:
      latest.promptDeliveryFailure,
    firstStdoutAt: latest.firstStdoutAt,
    firstStderrAt: latest.firstStderrAt,
    firstResponseAt: latest.firstResponseAt,
    firstNormalizedEventAt: latest.firstNormalizedEventAt,
    firstNormalizedEventType: latest.firstNormalizedEventType,
    resultObservedAt: latest.resultObservedAt,
    childCloseAt: latest.childCloseAt,
    childExitCode: latest.childExitCode,
    childSignal: latest.childSignal,
    exitReason: latest.exitReason,
    msSinceLastStdout: latest.msSinceLastStdout,
    lastEventType: latest.lastEventType,
    spawnErrorAt: latest.spawnErrorAt,
    spawnErrorMessage: latest.spawnErrorMessage,
    postExitState: latest.postExitState,
    postExitStateObservedAt:
      latest.postExitStateObservedAt,
    loopDecision: latest.loopDecision,
    lastEvent: latest.lastEvent,
    lastEventAt: latest.lastEventAt,
  });
}

export function recordLeaseReleaseLifecycle(
  entry: SessionEntry,
  interactionLog: InteractionLog,
  sessionId: string,
  beatId: string,
  reason: string,
  outcome: "success" | "warning" | "error",
  data?: Record<string, unknown>,
): void {
  const map = ensureLifecycleMap(entry);
  const latest = [...map.values()]
    .sort((left, right) => left.iteration - right.iteration)
    .at(-1);
  if (!latest) return;
  latest.leaseReleaseReason = reason;
  latest.leaseReleaseOutcome = outcome;
  latest.leaseReleaseRequestedAt = nowIso();
  latest.lastEvent = "lease_release_requested";
  latest.lastEventAt = latest.leaseReleaseRequestedAt;
  console.log(
    buildConsoleLine(
      sessionId,
      "lease_release_requested",
      latest,
    ),
  );
  interactionLog.logLifecycle?.({
    event: "lease_release_requested",
    beatId,
    iteration: latest.iteration,
    leaseReleaseRequestedAt: latest.leaseReleaseRequestedAt,
    leaseReleaseReason: latest.leaseReleaseReason,
    leaseReleaseOutcome: latest.leaseReleaseOutcome,
    leaseId: latest.leaseId,
    claimedState: latest.claimedState,
    agentName: latest.agentName,
    agentModel: latest.agentModel,
    agentVersion: latest.agentVersion,
    agentCommand: latest.agentCommand,
    ...(data ?? {}),
  });
}

export function runtimePreview(
  value: string,
): string | undefined {
  return trimPreview(value);
}

export function runtimeAgentPatch(
  agent: CliAgentTarget,
): Pick<
  TakeLoopIterationTrace,
  "agentName" | "agentModel" | "agentVersion" | "agentCommand"
> {
  return {
    agentName: agent.label ?? agent.agentId ?? agent.command,
    agentModel: agent.model,
    agentVersion: agent.version,
    agentCommand: agent.command,
  };
}
