import type { ChildProcess } from "node:child_process";
import type {
  AgentSessionRuntime,
  SessionRuntimeLifecycleEvent,
} from "@/lib/agent-session-runtime";
import {
  buildCodexInteractiveArgs,
  buildCopilotInteractiveArgs,
  buildOpenCodeInteractiveArgs,
  buildGeminiInteractiveArgs,
  buildClaudeInteractiveArgs,
} from "@/lib/agent-adapter";
import {
  createOpenCodeHttpSession,
} from "@/lib/opencode-http-session";
import {
  codexSessionOptionsForMode,
  createCodexJsonRpcSession,
} from "@/lib/codex-jsonrpc-session";
import {
  createGeminiAcpSession,
} from "@/lib/gemini-acp-session";
import type { CliAgentTarget } from "@/lib/types-agent-target";
import type {
  TakeLoopContext,
} from "@/lib/terminal-manager-take-loop";
import {
  handleTakeIterationClose,
} from "@/lib/terminal-manager-take-loop";
import {
  recordTakeLoopLifecycle,
} from "@/lib/terminal-manager-take-lifecycle";
import { resolveAgentCommand } from "@/lib/terminal-manager-types";
import {
  createPromptDispatchHooks,
} from "@/lib/terminal-manager-runtime-lifecycle";
import {
  captureChildCloseDiagnostics,
  formatDiagnosticsForLog,
} from "@/lib/agent-session-close-diagnostics";
import {
  formatTakeSceneOneShotFailure,
  type TerminalDispatchKind,
} from "@/lib/terminal-dispatch-capabilities";

export interface DeferredHttpRefs {
  childRef: ChildProcess | null;
  runtimeRef: AgentSessionRuntime | null;
}

export function createDeferredHttpSession(
  isHttpServer: boolean,
  refs: DeferredHttpRefs,
  pushEvent: TakeLoopContext["pushEvent"],
  emitRuntimeLifecycle: (
    event: SessionRuntimeLifecycleEvent,
  ) => void,
  model: string | undefined,
): import(
  "@/lib/opencode-http-session"
).OpenCodeHttpSession | undefined {
  if (!isHttpServer) return undefined;
  return createOpenCodeHttpSession(
    (jsonLine) => {
      if (refs.runtimeRef && refs.childRef) {
        refs.runtimeRef.injectLine(
          refs.childRef,
          jsonLine,
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
    { model },
  );
}

export function createTakeTransportSessions(
  isJsonRpc: boolean,
  isHttpServer: boolean,
  isAcp: boolean,
  cwd: string,
  model: string | undefined,
  approvalMode: CliAgentTarget["approvalMode"],
  refs: DeferredHttpRefs,
  pushEvent: TakeLoopContext["pushEvent"],
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
      codexSessionOptionsForMode(approvalMode),
    )
    : undefined;
  const acpSession = isAcp
    ? createGeminiAcpSession(
      cwd,
      createPromptDispatchHooks(
        "acp",
        emitRuntimeLifecycle,
      ),
    )
    : undefined;
  const httpSession = createDeferredHttpSession(
    isHttpServer,
    refs,
    pushEvent,
    emitRuntimeLifecycle,
    model,
  );
  return { jsonrpcSession, acpSession, httpSession };
}

export function buildSpawnArgs(
  agent: CliAgentTarget,
  dialect: import("@/lib/agent-adapter").AgentDialect,
  dispatchKind: TerminalDispatchKind,
  isInteractive: boolean,
  isJsonRpc: boolean,
  isHttpServer: boolean,
  isAcp: boolean,
): { cmd: string; args: string[] } {
  let cmd: string;
  let args: string[];
  if (isJsonRpc) {
    const built = buildCodexInteractiveArgs(agent);
    cmd = built.command;
    args = built.args;
  } else if (isHttpServer) {
    const built =
      buildOpenCodeInteractiveArgs(agent);
    cmd = built.command;
    args = built.args;
  } else if (isAcp) {
    const built =
      buildGeminiInteractiveArgs(agent);
    cmd = built.command;
    args = built.args;
  } else if (isInteractive && dialect === "copilot") {
    const built =
      buildCopilotInteractiveArgs(agent);
    cmd = built.command;
    args = built.args;
  } else if (isInteractive) {
    const built = buildClaudeInteractiveArgs(agent);
    cmd = built.command;
    args = built.args;
  } else {
    throw new Error(
      formatTakeSceneOneShotFailure(
        dialect,
        dispatchKind,
        "cli-arg",
      ),
    );
  }
  return { cmd: resolveAgentCommand(cmd), args };
}

export function wireTakeChildClose(
  ctx: TakeLoopContext,
  takeChild: ChildProcess,
  runtime: AgentSessionRuntime,
  effectiveAgent: CliAgentTarget,
  beatState: string | undefined,
): void {
  takeChild.on("close", (takeCode, signal) => {
    runtime.flushLineBuffer(takeChild);
    const diag = captureChildCloseDiagnostics(
      runtime.state,
    );
    runtime.dispose();
    takeChild.stdout?.removeAllListeners();
    takeChild.stderr?.removeAllListeners();
    ctx.entry.process = null;
    // Codex (and other JSON-RPC adapters) can exit
    // with code=0 even when the agent's turn errored
    // — e.g. an OpenAI quota / usageLimitExceeded
    // response yields `turn/completed status=failed`
    // followed by a clean process exit. Without this
    // override the take loop classifies the iteration
    // as a success, doesn't progress or roll back the
    // beat, and then dies on the next dispatch when
    // cross-agent review exclusion empties the pool.
    const effectiveCode =
      takeCode === 0 && diag.turnError ? 1 : takeCode;
    if (takeCode === 0 && diag.turnError) {
      const agentLabel =
        effectiveAgent.label ??
        effectiveAgent.agentId ??
        effectiveAgent.command;
      console.warn(
        `[terminal-manager] [${ctx.id}] [take-loop] ` +
        `agent exited code=0 but reported a failed ` +
        `turn (${diag.turnError.eventType ?? "unknown"}) ` +
        `— treating iteration as failure to trigger ` +
        `error retry / loud dispatch failure`,
      );
      ctx.pushEvent({
        type: "stderr",
        data: `\x1b[33m--- Agent ended turn with an ` +
          `error (${diag.turnError.eventType ?? "unknown"}) ` +
          `but exited cleanly. Treating iteration as ` +
          `failure so the take loop can retry or ` +
          `surface a dispatch failure ---\x1b[0m\n`,
        timestamp: Date.now(),
      });
      ctx.pushEvent({
        type: "agent_failure",
        data: JSON.stringify({
          kind: "turn_failed",
          message:
            `${agentLabel} ended turn with ` +
            `${diag.turnError.eventType ?? "an error"} ` +
            `(exit code 0). Take loop will retry with ` +
            `another agent.`,
          beatId: ctx.beatId,
        }),
        timestamp: Date.now(),
      });
    }
    console.log(
      `[terminal-manager] [${ctx.id}] [take-loop]` +
      ` child close: code=${takeCode}` +
      ` effectiveCode=${effectiveCode}` +
      formatDiagnosticsForLog(diag, signal) +
      ` aborted=${ctx.sessionAborted()}` +
      ` iteration=${ctx.takeIteration.value}` +
      ` beat=${ctx.beatId}`,
    );
    recordTakeLoopLifecycle(ctx, "child_close", {
      claimedState: beatState,
      childExitCode: takeCode,
      childSignal: signal,
      exitReason: diag.exitReason,
      msSinceLastStdout: diag.msSinceLastStdout,
      lastEventType: diag.lastEventType,
    });
    handleTakeIterationClose(
      ctx,
      effectiveCode,
      effectiveAgent,
      beatState ?? "unknown",
    ).catch((err) => {
      console.error(
        `[terminal-manager] [${ctx.id}] ` +
        `[take-loop] handleTakeIterationClose error:`,
        err,
      );
      ctx.finishSession(effectiveCode ?? 1);
    });
  });
}

export function wireTakeChildError(
  ctx: TakeLoopContext,
  takeChild: ChildProcess,
  runtime: AgentSessionRuntime,
  effectiveAgent: CliAgentTarget,
  effectiveDialect: string,
  beatState: string | undefined,
): void {
  const errorPrefix =
    `[take ${ctx.takeIteration.value} ` +
    `| beat: ${ctx.beatId.slice(0, 12)} ` +
    `| agent: ${effectiveDialect}]`;
  takeChild.on("error", (err) => {
    const diag = captureChildCloseDiagnostics(
      runtime.state,
    );
    console.error(
      `[terminal-manager] [${ctx.id}] ` +
      `[take-loop] spawn error:`,
      err.message +
      formatDiagnosticsForLog(diag, null),
    );
    recordTakeLoopLifecycle(ctx, "spawn_error", {
      claimedState: beatState,
      spawnErrorMessage: err.message,
      exitReason: diag.exitReason,
      msSinceLastStdout: diag.msSinceLastStdout,
      lastEventType: diag.lastEventType,
    });
    runtime.dispose();
    ctx.pushEvent({
      type: "stderr",
      data: `${errorPrefix} Process error: ${err.message}\n`,
      timestamp: Date.now(),
    });
    takeChild.stdout?.removeAllListeners();
    takeChild.stderr?.removeAllListeners();
    ctx.entry.process = null;
    handleTakeIterationClose(
      ctx,
      1,
      effectiveAgent,
      beatState ?? "unknown",
    ).catch((error) => {
      console.error(
        `[terminal-manager] [${ctx.id}] ` +
        `[take-loop] handleTakeIterationClose error ` +
        `after spawn error:`,
        error,
      );
      ctx.finishSession(1);
    });
  });
}

export function logAndSendTakePrompt(
  ctx: TakeLoopContext,
  takeChild: ChildProcess,
  runtime: AgentSessionRuntime,
  isInteractive: boolean,
  dialect: string,
  takePrompt: string,
  beatState: string | undefined,
): void {
  ctx.interactionLog.logBeatState({
    beatId: ctx.beatId,
    state: beatState ?? "unknown",
    phase: "before_prompt",
    iteration: ctx.takeIteration.value,
  });
  recordTakeLoopLifecycle(
    ctx,
    "prompt_send_attempted",
    {
      claimedState: beatState,
      leaseId: ctx.entry.knotsLeaseId,
    },
  );
  if (!isInteractive) {
    ctx.interactionLog.logPrompt(takePrompt, {
      source: `take_${ctx.takeIteration.value}`,
    });
    recordTakeLoopLifecycle(
      ctx,
      "prompt_send_succeeded",
      {
        claimedState: beatState,
        leaseId: ctx.entry.knotsLeaseId,
      },
    );
    return;
  }

  const iter = ctx.takeIteration.value;
  const sent = runtime.sendUserTurn(
    takeChild,
    takePrompt,
    `take_${iter}`,
  );
  if (sent) {
    recordTakeLoopLifecycle(
      ctx,
      "prompt_send_succeeded",
      {
        claimedState: beatState,
        leaseId: ctx.entry.knotsLeaseId,
      },
    );
    return;
  }
  recordTakeLoopLifecycle(
    ctx,
    "prompt_send_failed",
    {
      claimedState: beatState,
      leaseId: ctx.entry.knotsLeaseId,
      promptSendFailure:
        "runtime.sendUserTurn returned false",
    },
  );
  runtime.closeInput(takeChild);
  ctx.pushEvent({
    type: "stderr",
    data:
      `[take ${iter} | beat: ${ctx.beatId.slice(0, 12)} ` +
      `| agent: ${dialect}] Failed to send prompt ` +
      "— stdin is closed or unavailable.\n",
    timestamp: Date.now(),
  });
  takeChild.kill("SIGTERM");
  ctx.entry.process = null;
  ctx.finishSession(1);
}
