/**
 * Initial child process spawning for terminal-manager
 * sessions. I/O wiring is delegated to
 * terminal-manager-initial-io.ts.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { InteractionLog } from "@/lib/interaction-logger";
import {
  buildPromptModeArgs,
  buildCodexInteractiveArgs,
  buildCopilotInteractiveArgs,
  buildOpenCodeInteractiveArgs,
  buildGeminiInteractiveArgs,
  resolveDialect,
  createLineNormalizer,
} from "@/lib/agent-adapter";
import {
  resolveCapabilities,
  supportsInteractive,
} from "@/lib/agent-session-capabilities";
import {
  createCodexJsonRpcSession,
} from "@/lib/codex-jsonrpc-session";
import {
  createGeminiAcpSession,
} from "@/lib/gemini-acp-session";
import {
  supportsAutoFollowUp,
} from "@/lib/memory-manager-commands";
import type {
  TerminalSession,
  TerminalEvent,
} from "@/lib/types";
import type { CliAgentTarget } from "@/lib/types-agent-target";
import {
  formatAgentDisplayLabel,
  toExecutionAgentInfo,
} from "@/lib/agent-identity";
import {
  finishSessionImpl,
} from "@/lib/terminal-manager-initial-finish";
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
import {
  buildContinueAfterCleanClose,
} from "@/lib/terminal-manager-initial-follow-up";
import {
  createInitialRuntime,
} from "@/lib/terminal-manager-initial-runtime";

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
  const isTakeLoop =
    !prepared.effectiveParent && !customPrompt;
  const preferInteractive =
    isTakeLoop && supportsInteractive(dialect);
  const capabilities = resolveCapabilities(
    dialect, preferInteractive,
  );
  const isInteractive = capabilities.interactive;
  const pt = capabilities.promptTransport;
  const isJsonRpc = pt === "jsonrpc-stdio";
  const isHttpServer = pt === "http-server";
  const isAcp = pt === "acp-stdio";
  const { agentCmd, args } = buildAgentArgs(
    agent, dialect, isInteractive,
    isJsonRpc, isHttpServer, isAcp, prompt,
  );
  const normalizeEvent = createLineNormalizer(dialect);
  const jsonrpcSession = isJsonRpc
    ? createCodexJsonRpcSession() : undefined;
  const acpSession = isAcp
    ? createGeminiAcpSession(
        prepared.resolvedRepoPath,
      )
    : undefined;
  const takeLoopCtx = buildTakeLoopCtx(
    id, beatId, prepared, agent, agentInfo,
    entry, session, interactionLog, emitter,
    pushEvent, finishSession, sessionAborted,
  );
  const autoShipPrompt = buildAutoShipPrompt(
    isInteractive, customPrompt, prepared,
  );
  const {
    sessionBeatIds,
    stateRef,
    runtimeConfig,
  } = createInitialRuntime(
    id,
    dialect,
    capabilities,
    normalizeEvent,
    pushEvent,
    interactionLog,
    beatId,
    jsonrpcSession,
    acpSession,
  );
  stateRef.current = buildInitialState(
    autoShipPrompt, runtimeConfig,
  );
  const startTurn = (turnPrompt: string) => {
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
      isJsonRpc || isHttpServer || isAcp,
      stateRef.current,
      interactionLog, session, entry, id, agent,
      turnPrompt, sessions,
    );
  };
  startTurn(prompt);
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

// ─── Small helpers ───────────────────────────────────

function buildInitialState(
  autoShipPrompt: string | null,
  runtimeConfig: import(
    "@/lib/agent-session-runtime"
  ).SessionRuntimeConfig,
): import(
  "@/lib/terminal-manager-initial-io"
).InitialChildState {
  return createInitialChildState(
    autoShipPrompt, runtimeConfig,
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
  dialect: import("@/lib/agent-adapter").AgentDialect,
  isInteractive: boolean,
  isJsonRpc: boolean,
  isHttpServer: boolean,
  isAcp: boolean,
  prompt: string,
): { agentCmd: string; args: string[] } {
  let agentCmd: string;
  let args: string[];
  if (isJsonRpc) {
    const built = buildCodexInteractiveArgs(agent);
    agentCmd = built.command;
    args = built.args;
  } else if (isHttpServer) {
    const built =
      buildOpenCodeInteractiveArgs(agent);
    agentCmd = built.command;
    args = built.args;
  } else if (isAcp) {
    const built =
      buildGeminiInteractiveArgs(agent);
    agentCmd = built.command;
    args = built.args;
  } else if (isInteractive && dialect === "copilot") {
    const built =
      buildCopilotInteractiveArgs(agent);
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
        `${formatAgentDisplayLabel(agent)}` +
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
