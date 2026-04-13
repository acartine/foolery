import type { ChildProcess } from "node:child_process";
import type { EventEmitter } from "node:events";
import type { InteractionLog } from "@/lib/interaction-logger";
import {
  buildPromptModeArgs,
  buildCodexInteractiveArgs,
  buildCopilotInteractiveArgs,
  buildOpenCodeInteractiveArgs,
  buildGeminiInteractiveArgs,
} from "@/lib/agent-adapter";
import type {
  SessionRuntimeConfig,
  SessionRuntimeLifecycleEvent,
} from "@/lib/agent-session-runtime";
import {
  createOpenCodeHttpSession,
} from "@/lib/opencode-http-session";
import {
  createCodexJsonRpcSession,
} from "@/lib/codex-jsonrpc-session";
import {
  createGeminiAcpSession,
} from "@/lib/gemini-acp-session";
import {
  supportsAutoFollowUp,
} from "@/lib/memory-manager-commands";
import {
  formatAgentDisplayLabel,
  toExecutionAgentInfo,
} from "@/lib/agent-identity";
import type {
  TerminalEvent,
  TerminalSession,
} from "@/lib/types";
import type { CliAgentTarget } from "@/lib/types-agent-target";
import type {
  PreparedTargets,
} from "@/lib/terminal-manager-session-prep";
import type {
  SessionEntry,
} from "@/lib/terminal-manager-types";
import {
  createInitialChildState,
  closeInput,
  sendUserTurn,
} from "@/lib/terminal-manager-initial-io";
import type {
  TakeLoopContext,
} from "@/lib/terminal-manager-take-loop";
import {
  recordTakeLoopLifecycle,
} from "@/lib/terminal-manager-take-lifecycle";
import { resolveAgentCommand } from "@/lib/terminal-manager-types";
import {
  buildSingleBeatCompletionFollowUp,
  buildWaveCompletionFollowUp,
} from "@/lib/terminal-manager-workflow";
import {
  createPromptDispatchHooks,
} from "@/lib/terminal-manager-runtime-lifecycle";

type InitialChildState = import(
  "@/lib/terminal-manager-initial-io"
).InitialChildState;

export function createOpenCodeInteractiveSession(
  stateRef: { current: InitialChildState },
  pushEvent: (evt: TerminalEvent) => void,
  emitRuntimeLifecycle: (
    event: SessionRuntimeLifecycleEvent,
  ) => void,
): import(
  "@/lib/opencode-http-session"
).OpenCodeHttpSession {
  return createOpenCodeHttpSession(
    (jsonLine) => {
      if (stateRef.current.child) {
        stateRef.current.runtime.injectLine(
          stateRef.current.child, jsonLine,
        );
      }
    },
    (errMsg) => {
      pushEvent({
        type: "stderr",
        data: errMsg + "\n",
        timestamp: Date.now(),
      });
    },
    createPromptDispatchHooks(
      "http",
      emitRuntimeLifecycle,
    ),
  );
}

export function createInitialTransportSessions(
  isJsonRpc: boolean,
  isHttpServer: boolean,
  isAcp: boolean,
  resolvedRepoPath: string,
  stateRef: { current: InitialChildState },
  pushEvent: (evt: TerminalEvent) => void,
  emitRuntimeLifecycle: (
    event: SessionRuntimeLifecycleEvent,
  ) => void,
) {
  const jsonrpcSession = isJsonRpc
    ? createCodexJsonRpcSession(
      createPromptDispatchHooks(
        "jsonrpc",
        emitRuntimeLifecycle,
      ),
    )
    : undefined;
  const httpSession = isHttpServer
    ? createOpenCodeInteractiveSession(
      stateRef,
      pushEvent,
      emitRuntimeLifecycle,
    )
    : undefined;
  const acpSession = isAcp
    ? createGeminiAcpSession(
      resolvedRepoPath,
      createPromptDispatchHooks(
        "acp",
        emitRuntimeLifecycle,
      ),
    )
    : undefined;
  return { jsonrpcSession, httpSession, acpSession };
}

export function buildInitialState(
  autoShipPrompt: string | null,
  runtimeConfig: SessionRuntimeConfig,
): InitialChildState {
  return createInitialChildState(
    autoShipPrompt,
    runtimeConfig,
  );
}

export function buildTakeLoopCtx(
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
): TakeLoopContext {
  entry.takeLoopLifecycle = new Map();
  return {
    id,
    beatId,
    beat: prepared.beat,
    repoPath: prepared.repoPath,
    resolvedRepoPath: prepared.resolvedRepoPath,
    cwd: prepared.resolvedRepoPath,
    memoryManagerType: prepared.memoryManagerType,
    workflowsById: prepared.workflowsById,
    fallbackWorkflow: prepared.fallbackWorkflow,
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
    knotsLeaseTerminationStarted: { value: false },
    takeIteration: { value: 1 },
    claimsPerQueueType: new Map(),
    lastAgentPerQueueType: new Map(),
    failedAgentsPerQueueType: new Map(),
    claimedAt: Date.now(),
  };
}

export function buildAutoShipPrompt(
  isInteractive: boolean,
  customPrompt: string | undefined,
  prepared: PreparedTargets,
): string | null {
  if (!isInteractive || customPrompt) {
    return null;
  }
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

export function buildAgentArgs(
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
      "-p",
      "--input-format",
      "stream-json",
      "--verbose",
      "--output-format",
      "stream-json",
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
  return {
    agentCmd: resolveAgentCommand(agentCmd),
    args,
  };
}

export function logAgentSpawn(
  agent: CliAgentTarget,
  child: ChildProcess,
): void {
  const modelStr = agent.model
    ? ` (model: ${agent.model})`
    : "";
  console.log(
    `[terminal-manager]   agent: ` +
    `${agent.command}${modelStr}`,
  );
  console.log(
    `[terminal-manager]   pid: ` +
    `${child.pid ?? "failed to spawn"}`,
  );
}

export function sendInitialPrompt(
  child: ChildProcess,
  isInteractive: boolean,
  state: InitialChildState,
  interactionLog: InteractionLog,
  session: TerminalSession,
  entry: SessionEntry,
  id: string,
  agent: CliAgentTarget,
  prompt: string,
  sessions: Map<string, SessionEntry>,
  takeLoopCtx?: TakeLoopContext,
): void {
  if (takeLoopCtx) {
    recordTakeLoopLifecycle(
      takeLoopCtx,
      "prompt_send_attempted",
      {
        claimedState: takeLoopCtx.beat.state,
        leaseId: entry.knotsLeaseId,
      },
    );
  }
  if (!isInteractive) {
    interactionLog.logPrompt(prompt, {
      source: "initial",
    });
    if (takeLoopCtx) {
      recordTakeLoopLifecycle(
        takeLoopCtx,
        "prompt_send_succeeded",
        {
          claimedState: takeLoopCtx.beat.state,
          leaseId: entry.knotsLeaseId,
        },
      );
    }
    return;
  }

  const sent = sendUserTurn(
    child,
    state,
    interactionLog,
    prompt,
    "initial",
  );
  if (sent) {
    if (takeLoopCtx) {
      recordTakeLoopLifecycle(
        takeLoopCtx,
        "prompt_send_succeeded",
        {
          claimedState: takeLoopCtx.beat.state,
          leaseId: entry.knotsLeaseId,
        },
      );
    }
    return;
  }

  if (takeLoopCtx) {
    recordTakeLoopLifecycle(
      takeLoopCtx,
      "prompt_send_failed",
      {
        claimedState: takeLoopCtx.beat.state,
        leaseId: entry.knotsLeaseId,
        promptSendFailure:
          "stdin unavailable for initial prompt",
      },
    );
  }
  closeInput(child, state);
  session.status = "error";
  interactionLog.logEnd(1, "error");
  child.kill("SIGTERM");
  entry.releaseKnotsLease?.(
    "initial_prompt_send_failed",
    "error",
  );
  sessions.delete(id);
  throw new Error(
    `Failed to send initial prompt to agent: ${
      formatAgentDisplayLabel(agent)
    }${agent.model ? ` (model: ${agent.model})` : ""}`,
  );
}
