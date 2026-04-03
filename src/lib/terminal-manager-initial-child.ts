/**
 * Initial child process spawning for terminal-manager
 * sessions. I/O wiring is delegated to
 * terminal-manager-initial-io.ts.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { InteractionLog } from "@/lib/interaction-logger";
import { regroomAncestors } from "@/lib/regroom";
import {
  buildPromptModeArgs,
  buildCodexInteractiveArgs,
  resolveDialect,
  createLineNormalizer,
} from "@/lib/agent-adapter";
import {
  resolveCapabilities,
} from "@/lib/agent-session-capabilities";
import {
  createCodexJsonRpcSession,
} from "@/lib/codex-jsonrpc-session";
import {
  supportsAutoFollowUp,
} from "@/lib/memory-manager-commands";
import type {
  TerminalSession,
  TerminalEvent,
} from "@/lib/types";
import {
  updateMessageTypeIndexFromSession,
} from "@/lib/agent-message-type-index";
import type { CliAgentTarget } from "@/lib/types-agent-target";
import {
  agentDisplayName,
  toExecutionAgentInfo,
} from "@/lib/agent-identity";
import {
  buildSingleBeatCompletionFollowUp,
  buildWaveCompletionFollowUp,
} from "@/lib/terminal-manager-workflow";
import type { TakeLoopContext } from "@/lib/terminal-manager-take-loop";
import {
  type SessionEntry,
  resolveAgentCommand,
} from "@/lib/terminal-manager-types";
import type {
  PreparedTargets,
} from "@/lib/terminal-manager-session-prep";
import {
  createInitialChildState,
  closeInput,
  sendUserTurn,
  wireStdout,
  wireStderr,
  wireClose,
  wireError,
} from "@/lib/terminal-manager-initial-io";

// ─── Constants ───────────────────────────────────────

const CLEANUP_DELAY_MS = 5 * 60 * 1000;

// ─── spawnInitialChild (entry point) ─────────────────

export function spawnInitialChild(
  id: string,
  beatId: string,
  prepared: PreparedTargets,
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
  let sessionFinished = false;
  let sessionAborted = false;
  entry.abort = () => { sessionAborted = true; };

  const finishSession = (exitCode: number) => {
    if (sessionFinished) return;
    sessionFinished = true;
    finishSessionImpl(
      exitCode, session, sessionAborted,
      interactionLog, pushEvent, entry, emitter,
      buffer, id, beatId, prepared, agent,
      sessions,
    );
  };

  const dialect = resolveDialect(agent.command);
  const isTakeLoop =
    !prepared.effectiveParent && !customPrompt;
  const preferInteractive =
    isTakeLoop && dialect === "codex";
  const capabilities = resolveCapabilities(
    dialect, preferInteractive,
  );
  const isInteractive = capabilities.interactive;
  const isJsonRpc =
    capabilities.promptTransport === "jsonrpc-stdio";
  const { agentCmd, args } = buildAgentArgs(
    agent, isInteractive, isJsonRpc, prompt,
  );
  const normalizeEvent =
    createLineNormalizer(dialect);

  const jsonrpcSession = isJsonRpc
    ? createCodexJsonRpcSession() : undefined;

  const takeLoopCtx = buildTakeLoopCtx(
    id, beatId, prepared, agent, agentInfo,
    entry, session, interactionLog, emitter,
    pushEvent, finishSession,
    () => sessionAborted,
  );

  const autoShipPrompt = buildAutoShipPrompt(
    isInteractive, customPrompt, prepared,
  );
  const sessionBeatIds = [beatId];
  const state = buildInitialState(
    id, dialect, capabilities, normalizeEvent,
    pushEvent, interactionLog, sessionBeatIds,
    autoShipPrompt, jsonrpcSession,
  );

  const child = spawnAndWire(
    agentCmd, args, prepared, isInteractive,
    id, beatId, isTakeLoop, sessionBeatIds,
    dialect, interactionLog, normalizeEvent,
    pushEvent, state, entry, finishSession,
    agent, takeLoopCtx, jsonrpcSession,
  );

  sendInitialPrompt(
    child, isInteractive, isJsonRpc, state,
    interactionLog, session, entry, id, agent,
    prompt, sessions,
  );

  return session;
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
  logAgentSpawn(id, agent, child);

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

  return child;
}

// ─── Small helpers ───────────────────────────────────

function buildInitialState(
  id: string,
  dialect: import("@/lib/agent-adapter").AgentDialect,
  capabilities: import(
    "@/lib/agent-session-capabilities"
  ).AgentSessionCapabilities,
  normalizeEvent: ReturnType<
    typeof createLineNormalizer
  >,
  pushEvent: (evt: TerminalEvent) => void,
  interactionLog: InteractionLog,
  beatIds: string[],
  autoShipPrompt: string | null,
  jsonrpcSession?: import(
    "@/lib/codex-jsonrpc-session"
  ).CodexJsonRpcSession,
): import(
  "@/lib/terminal-manager-initial-io"
).InitialChildState {
  return createInitialChildState(
    autoShipPrompt,
    {
      id,
      dialect,
      capabilities,
      normalizeEvent,
      pushEvent,
      interactionLog,
      beatIds,
      jsonrpcSession,
    },
  );
}

function buildTakeLoopCtx(
  id: string,
  beatId: string,
  prepared: PreparedTargets,
  agent: CliAgentTarget,
  agentInfo: ReturnType<typeof toExecutionAgentInfo>,
  entry: SessionEntry,
  session: TerminalSession,
  interactionLog: InteractionLog,
  emitter: EventEmitter,
  pushEvent: (evt: TerminalEvent) => void,
  finishSession: (code: number) => void,
  sessionAborted: () => boolean,
): TakeLoopContext {
  return {
    id, beatId,
    beat: prepared.beat,
    repoPath: prepared.repoPath,
    resolvedRepoPath: prepared.resolvedRepoPath,
    cwd: prepared.resolvedRepoPath,
    memoryManagerType: prepared.memoryManagerType,
    workflowsById: prepared.workflowsById,
    fallbackWorkflow: prepared.fallbackWorkflow,
    agent, agentInfo, entry, session,
    interactionLog, emitter, pushEvent,
    finishSession, sessionAborted,
    knotsLeaseTerminationStarted: { value: false },
    takeIteration: { value: 1 },
    claimsPerQueueType: new Map(),
    lastAgentPerQueueType: new Map(),
    failedAgentsPerQueueType: new Map(),
    claimedAt: Date.now(),
  };
}

function buildAutoShipPrompt(
  isInteractive: boolean,
  customPrompt: string | undefined,
  prepared: PreparedTargets,
): string | null {
  if (!isInteractive || customPrompt) return null;
  if (
    !supportsAutoFollowUp(prepared.memoryManagerType)
  ) {
    return null;
  }
  return prepared.effectiveParent
    ? buildWaveCompletionFollowUp(
      prepared.beat.id,
      prepared.sceneTargets,
      prepared.memoryManagerType,
    )
    : buildSingleBeatCompletionFollowUp(
      prepared.primaryTarget,
      prepared.memoryManagerType,
    );
}

function buildAgentArgs(
  agent: CliAgentTarget,
  isInteractive: boolean,
  isJsonRpc: boolean,
  prompt: string,
): { agentCmd: string; args: string[] } {
  let agentCmd: string;
  let args: string[];
  if (isJsonRpc) {
    const built = buildCodexInteractiveArgs(agent);
    agentCmd = built.command;
    args = built.args;
  } else if (isInteractive) {
    agentCmd = agent.command;
    args = [
      "-p", "--input-format", "stream-json",
      "--verbose", "--output-format", "stream-json",
      "--dangerously-skip-permissions",
    ];
    if (agent.model) {
      args.push("--model", agent.model);
    }
  } else {
    const built = buildPromptModeArgs(agent, prompt);
    agentCmd = built.command;
    args = built.args;
  }
  agentCmd = resolveAgentCommand(agentCmd);
  return { agentCmd, args };
}

function logAgentSpawn(
  id: string,
  agent: CliAgentTarget,
  child: import("node:child_process").ChildProcess,
): void {
  const modelStr = agent.model
    ? ` (model: ${agent.model})` : "";
  console.log(
    `[terminal-manager]   agent: ` +
    `${agent.command}${modelStr}`,
  );
  console.log(
    `[terminal-manager]   pid: ` +
    `${child.pid ?? "failed to spawn"}`,
  );
}

// ─── finishSession implementation ────────────────────

function finishSessionImpl(
  exitCode: number,
  session: TerminalSession,
  sessionAborted: boolean,
  interactionLog: InteractionLog,
  pushEvent: (evt: TerminalEvent) => void,
  entry: SessionEntry,
  emitter: EventEmitter,
  buffer: TerminalEvent[],
  id: string,
  beatId: string,
  prepared: PreparedTargets,
  agent: CliAgentTarget,
  sessions: Map<string, SessionEntry>,
): void {
  session.exitCode = exitCode;
  session.status = sessionAborted
    ? "aborted"
    : exitCode === 0 ? "completed" : "error";
  interactionLog.logEnd(exitCode, session.status);
  pushEvent({
    type: "exit",
    data: String(exitCode),
    timestamp: Date.now(),
  });
  entry.process = null;
  entry.abort = undefined;

  if (exitCode === 0) {
    handleSuccessCleanup(
      beatId, prepared, interactionLog, agent,
    );
  }

  entry.releaseKnotsLease?.(
    sessionAborted
      ? "session_aborted"
      : exitCode === 0
        ? "session_completed"
        : "session_error",
    exitCode === 0 ? "success" : "warning",
    { exitCode, finalStatus: session.status },
  );

  setTimeout(
    () => { emitter.removeAllListeners(); }, 2000,
  );
  setTimeout(() => {
    buffer.length = 0;
    sessions.delete(id);
  }, CLEANUP_DELAY_MS);
}

function handleSuccessCleanup(
  beatId: string,
  prepared: PreparedTargets,
  interactionLog: InteractionLog,
  agent: CliAgentTarget,
): void {
  regroomAncestors(
    beatId, prepared.resolvedRepoPath,
  ).catch((err) => {
    console.error(
      `[terminal-manager] regroom failed ` +
      `for ${beatId}:`, err,
    );
  });
  const logFile = interactionLog.filePath;
  if (logFile) {
    updateMessageTypeIndexFromSession(
      logFile,
      agentDisplayName(agent),
      agent.model,
    ).catch((err) => {
      console.error(
        `[terminal-manager] message type index ` +
        `update failed:`, err,
      );
    });
  }
}

// ─── sendInitialPrompt ──────────────────────────────

function sendInitialPrompt(
  child: import("node:child_process").ChildProcess,
  isInteractive: boolean,
  isJsonRpc: boolean,
  state: import(
    "@/lib/terminal-manager-initial-io"
  ).InitialChildState,
  interactionLog: InteractionLog,
  session: TerminalSession,
  entry: SessionEntry,
  id: string,
  agent: CliAgentTarget,
  prompt: string,
  sessions: Map<string, SessionEntry>,
): void {
  if (isInteractive) {
    // For JSON-RPC, sendUserTurn delegates to
    // startTurn() which queues until handshake
    // completes. For stream-json, it writes
    // directly to stdin.
    const sent = sendUserTurn(
      child, state, interactionLog,
      prompt, "initial",
    );
    if (!sent) {
      closeInput(child, state);
      session.status = "error";
      interactionLog.logEnd(1, "error");
      child.kill("SIGTERM");
      entry.releaseKnotsLease?.(
        "initial_prompt_send_failed", "error",
      );
      sessions.delete(id);
      const desc =
        `${agentDisplayName(agent)}` +
        (agent.model
          ? ` (model: ${agent.model})`
          : "");
      throw new Error(
        `Failed to send initial prompt ` +
        `to agent: ${desc}`,
      );
    }
  } else {
    interactionLog.logPrompt(prompt, {
      source: "initial",
    });
  }
}
