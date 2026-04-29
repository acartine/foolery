/**
 * Initial child process spawning for terminal-manager
 * sessions. I/O wiring is delegated to
 * terminal-manager-initial-io.ts.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { InteractionLog } from "@/lib/interaction-logger";
import {
  resolveDialect,
  createLineNormalizer,
} from "@/lib/agent-adapter";
import type {
  AgentSessionCapabilities,
} from "@/lib/agent-session-capabilities";
import {
  emitTerminalDispatchFailure,
  resolveTakeSceneRuntimeSelection,
  terminalDispatchKind,
} from "@/lib/terminal-dispatch-capabilities";
import { TerminalSession, TerminalEvent } from "@/lib/types";
import type { CliAgentTarget } from "@/lib/types-agent-target";
import {
  toExecutionAgentInfo,
} from "@/lib/agent-identity";
import {
  finishSessionImpl,
} from "@/lib/terminal-manager-initial-finish";
import {
  recordTakeLoopLifecycle,
  recordSessionFinishLifecycle,
} from "@/lib/terminal-manager-take-lifecycle";
import type { TakeLoopContext } from "@/lib/terminal-manager-take-loop";
import type { SessionEntry } from "@/lib/terminal-manager-types";
import type { PreparedTargets } from "@/lib/terminal-manager-session-prep";
import {
  wireStdout,
  wireStderr,
  wireClose,
  wireError,
} from "@/lib/terminal-manager-initial-io";
import {
  buildContinueAfterCleanClose,
} from "@/lib/terminal-manager-initial-follow-up";
import {
  createInitialRuntime,
} from "@/lib/terminal-manager-initial-runtime";
import type {
  SessionRuntimeLifecycleEvent,
} from "@/lib/agent-session-runtime";
import {
  buildAgentArgs,
  buildAutoShipPrompt,
  buildInitialState,
  buildTakeLoopCtx,
  createInitialTransportSessions,
  logAgentSpawn,
  sendInitialPrompt,
} from "@/lib/terminal-manager-initial-child-helpers";
import {
  createTakeLoopRuntimeLifecycleHandler,
} from "@/lib/terminal-manager-runtime-lifecycle";
import {
  attachApprovalResponder, createApprovalRequestHandler,
} from "@/lib/terminal-approval-session";

// ─── Session lifecycle factory ──────────────────────

function createSessionLifecycle(
  entry: SessionEntry,
  session: TerminalSession,
  interactionLog: InteractionLog,
  pushEvent: (evt: TerminalEvent) => void,
  emitter: EventEmitter,
  buffer: TerminalEvent[],
  id: string,
  beatId: string,
  prepared: PreparedTargets,
  agent: CliAgentTarget,
  sessions: Map<string, SessionEntry>,
): {
  finishSession: (exitCode: number) => void;
  sessionAborted: () => boolean;
} {
  let finished = false;
  let aborted = false;
  entry.abort = () => { aborted = true; };
  return {
    finishSession: (exitCode: number) => {
      if (finished) return;
      finished = true;
      recordSessionFinishLifecycle(
        entry,
        interactionLog,
        id,
        beatId,
        session,
        exitCode,
      );
      finishSessionImpl(
        exitCode, session, aborted,
        interactionLog, pushEvent, entry,
        emitter, buffer, id, beatId,
        prepared, agent, sessions,
      );
    },
    sessionAborted: () => aborted,
  };
}

// ─── spawnInitialChild (entry point) ─────────────────

export function spawnInitialChild(
  id: string,
  beatId: string,
  prepared: PreparedTargets,
  interactiveSessionTimeoutMinutes: number,
  agent: CliAgentTarget,
  agentInfo: ReturnType<typeof toExecutionAgentInfo>,
  session: TerminalSession,
  entry: SessionEntry,
  emitter: EventEmitter,
  buffer: TerminalEvent[],
  interactionLog: InteractionLog,
  pushEvent: (evt: TerminalEvent) => void,
  prompt: string,
  customPrompt: string | undefined,
  sessions: Map<string, SessionEntry>,
): TerminalSession {
  const { finishSession, sessionAborted } =
    createSessionLifecycle(
      entry, session, interactionLog, pushEvent,
      emitter, buffer, id, beatId, prepared,
      agent, sessions,
    );
  const dialect = resolveDialect(agent.command);
  const {
    isTakeLoop,
    isInteractive,
    agentCmd,
    args,
    normalizeEvent,
    takeLoopCtx,
    sessionBeatIds,
    stateRef,
    runtimeConfig,
    jsonrpcSession,
    acpSession,
  } = prepareInitialRuntimeBundle(
    id,
    beatId,
    prepared,
    interactiveSessionTimeoutMinutes,
    agent,
    agentInfo,
    session,
    entry,
    emitter,
    interactionLog,
    pushEvent,
    customPrompt,
    finishSession,
    sessionAborted,
    dialect,
  );
  const startTurn = (turnPrompt: string) => {
    if (isTakeLoop) {
      recordTakeLoopLifecycle(
        takeLoopCtx,
        "prompt_built",
        {
          claimedState: prepared.beat.state,
          leaseId: entry.knotsLeaseId,
          promptLength: turnPrompt.length,
          promptSource: "initial",
        },
      );
    }
    const child = spawnAndWire(
      agentCmd, args, prepared, isInteractive,
      id, beatId, isTakeLoop, sessionBeatIds,
      dialect, interactionLog, normalizeEvent,
      pushEvent, stateRef.current, entry,
      finishSession,
      agent, takeLoopCtx, jsonrpcSession, acpSession,
      buildContinueAfterCleanClose(
        stateRef,
    runtimeConfig,
    buildInitialState,
    pushEvent,
    startTurn,
      ),
    );
    sendInitialPrompt(
      child, isInteractive,
      stateRef.current,
      interactionLog, session, entry, id, agent,
      turnPrompt, sessions,
      isTakeLoop ? takeLoopCtx : undefined,
    );
  };
  startTurn(prompt);
  return session;
}

function buildInitialRuntimeContext(
  id: string,
  dialect: import("@/lib/agent-adapter").AgentDialect,
  capabilities: AgentSessionCapabilities,
  watchdogTimeoutMs: number | null,
  normalizeEvent: ReturnType<typeof createLineNormalizer>,
  pushEvent: (evt: TerminalEvent) => void,
  interactionLog: InteractionLog,
  beatId: string,
) {
  return createInitialRuntime(
    id,
    dialect,
    capabilities,
    watchdogTimeoutMs,
    normalizeEvent,
    pushEvent,
    interactionLog,
    beatId,
  );
}

function buildInitialTakeLoopContext(
  id: string,
  beatId: string,
  prepared: PreparedTargets,
  interactiveSessionTimeoutMinutes: number,
  agent: CliAgentTarget,
  agentInfo: ReturnType<typeof toExecutionAgentInfo>,
  entry: SessionEntry,
  session: TerminalSession,
  interactionLog: InteractionLog,
  emitter: EventEmitter,
  pushEvent: (evt: TerminalEvent) => void,
  finishSession: (code: number) => void,
  sessionAborted: () => boolean,
) {
  return buildTakeLoopCtx(
    id,
    beatId,
    prepared,
    interactiveSessionTimeoutMinutes,
    agent,
    agentInfo,
    entry,
    session,
    interactionLog,
    emitter,
    pushEvent,
    finishSession,
    sessionAborted,
  );
}

function resolveInitialRuntimeSelectionOrEmit(
  dialect: import("@/lib/agent-adapter").AgentDialect,
  dispatchKind: ReturnType<typeof terminalDispatchKind>,
  interactiveSessionTimeoutMinutes: number,
  pushEvent: (evt: TerminalEvent) => void,
) {
  try {
    return resolveTakeSceneRuntimeSelection(
      dialect,
      dispatchKind,
      interactiveSessionTimeoutMinutes,
    );
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unknown terminal dispatch failure";
    emitTerminalDispatchFailure(pushEvent, message);
    throw error;
  }
}

function prepareInitialRuntimeBundle(
  id: string,
  beatId: string,
  prepared: PreparedTargets,
  interactiveSessionTimeoutMinutes: number,
  agent: CliAgentTarget,
  agentInfo: ReturnType<typeof toExecutionAgentInfo>,
  session: TerminalSession,
  entry: SessionEntry,
  emitter: EventEmitter,
  interactionLog: InteractionLog,
  pushEvent: (evt: TerminalEvent) => void,
  customPrompt: string | undefined,
  finishSession: (code: number) => void,
  sessionAborted: () => boolean,
  dialect: import("@/lib/agent-adapter").AgentDialect,
) {
  const isTakeLoop = !prepared.effectiveParent &&
    !customPrompt;
  const dispatchKind =
    terminalDispatchKind(prepared.effectiveParent);
  const runtimeSelection =
    resolveInitialRuntimeSelectionOrEmit(
      dialect,
      dispatchKind,
      interactiveSessionTimeoutMinutes,
      pushEvent,
    );
  const {
    capabilities,
    isInteractive,
    transport,
    watchdogTimeoutMs,
  } = runtimeSelection;
  const { agentCmd, args } = buildAgentArgs(
    agent, dialect, dispatchKind, isInteractive,
    transport === "jsonrpc-stdio",
    transport === "http-server",
    transport === "acp-stdio",
  );
  const normalizeEvent = createLineNormalizer(dialect);
  const takeLoopCtx = buildInitialTakeLoopContext(
    id, beatId, prepared,
    interactiveSessionTimeoutMinutes,
    agent, agentInfo, entry,
    session, interactionLog, emitter, pushEvent,
    finishSession,
    sessionAborted,
  );
  const { sessionBeatIds, stateRef, runtimeConfig } =
    buildInitialRuntimeContext(
      id, dialect, capabilities,
      watchdogTimeoutMs, normalizeEvent,
      pushEvent, interactionLog, beatId,
    );
  const emitRuntimeLifecycle = (event:
    SessionRuntimeLifecycleEvent) =>
    runtimeConfig.onLifecycleEvent?.(event);
  const sessions = createInitialTransportSessions(
    transport === "jsonrpc-stdio",
    transport === "http-server",
    transport === "acp-stdio",
    prepared.resolvedRepoPath,
    agent.model,
    stateRef,
    pushEvent,
    emitRuntimeLifecycle,
  );
  finalizeInitialRuntimeConfig(
    runtimeConfig,
    sessions,
    isTakeLoop
      ? createTakeLoopRuntimeLifecycleHandler(
        takeLoopCtx,
      )
      : undefined,
    buildAutoShipPrompt(
      isInteractive,
      customPrompt,
      prepared,
    ),
    stateRef,
    entry,
  );
  return {
    isTakeLoop,
    isInteractive,
    agentCmd,
    args,
    normalizeEvent,
    takeLoopCtx,
    sessionBeatIds,
    stateRef,
    runtimeConfig,
    jsonrpcSession: sessions.jsonrpcSession,
    acpSession: sessions.acpSession,
  };
}

function finalizeInitialRuntimeConfig(
  runtimeConfig: ReturnType<
    typeof createInitialRuntime
  >["runtimeConfig"],
  sessions: ReturnType<
    typeof createInitialTransportSessions
  >,
  lifecycleHandler:
    | ((event: SessionRuntimeLifecycleEvent) => void)
    | undefined,
  autoShipPrompt: string | null,
  stateRef: ReturnType<
    typeof createInitialRuntime
  >["stateRef"],
  entry: SessionEntry,
): void {
  Object.assign(runtimeConfig, {
    httpSession: sessions.httpSession,
    jsonrpcSession: sessions.jsonrpcSession,
    acpSession: sessions.acpSession,
    onApprovalRequest: createApprovalRequestHandler(entry),
    ...(lifecycleHandler
      ? { onLifecycleEvent: lifecycleHandler }
      : {}),
  });
  stateRef.current = buildInitialState(
    autoShipPrompt,
    runtimeConfig,
  );
}

// ─── Spawn + wire ───────────────────────────────────

function spawnAndWire(
  agentCmd: string,
  args: string[],
  prepared: PreparedTargets,
  isInteractive: boolean,
  id: string,
  beatId: string,
  isTakeLoop: boolean,
  sessionBeatIds: string[],
  dialect: import("@/lib/agent-adapter").AgentDialect,
  interactionLog: InteractionLog,
  normalizeEvent: ReturnType<
    typeof createLineNormalizer
  >,
  pushEvent: (evt: TerminalEvent) => void,
  state: import(
    "@/lib/terminal-manager-initial-io"
  ).InitialChildState,
  entry: SessionEntry,
  finishSession: (code: number) => void,
  agent: CliAgentTarget,
  takeLoopCtx: TakeLoopContext,
  jsonrpcSession?: import(
    "@/lib/codex-jsonrpc-session"
  ).CodexJsonRpcSession,
  acpSession?: import(
    "@/lib/gemini-acp-session"
  ).GeminiAcpSession,
  continueAfterCleanClose?: (
    exitReason: import(
      "@/lib/agent-session-runtime"
    ).SessionExitReason | null,
  ) => Promise<boolean>,
): import("node:child_process").ChildProcess {
  const child = spawn(agentCmd, args, {
    cwd: prepared.resolvedRepoPath,
    stdio: [
      isInteractive ? "pipe" : "ignore",
      "pipe", "pipe",
    ],
    detached: true,
  });
  entry.process = child;
  attachApprovalResponder(entry, state.runtime);
  logAgentSpawn(agent, child);

  wireStdout(
    child, id, sessionBeatIds, dialect,
    interactionLog, normalizeEvent,
    pushEvent, state,
  );
  wireStderr(
    child, id, interactionLog, pushEvent, state,
  );
  wireClose(
    child, id, beatId, isTakeLoop, state, entry,
    interactionLog, pushEvent, finishSession,
    agent, prepared, takeLoopCtx,
    continueAfterCleanClose,
  );
  wireError(
    child, id, isTakeLoop, state, entry,
    pushEvent, finishSession,
    agent, prepared, takeLoopCtx,
  );

  if (isTakeLoop) {
    interactionLog.logBeatState({
      beatId,
      state: prepared.beat.state ?? "unknown",
      phase: "before_prompt",
      iteration: takeLoopCtx.takeIteration.value,
    });
  }

  if (jsonrpcSession) {
    jsonrpcSession.sendHandshake(child);
  }
  if (acpSession) {
    acpSession.sendHandshake(child);
  }

  return child;
}
