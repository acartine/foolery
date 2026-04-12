import type { ChildProcess } from "node:child_process";
import type {
  AgentSessionRuntime,
  SessionRuntimeLifecycleEvent,
} from "@/lib/agent-session-runtime";
import {
  buildPromptModeArgs,
  buildCodexInteractiveArgs,
  buildCopilotInteractiveArgs,
  buildOpenCodeInteractiveArgs,
  buildGeminiInteractiveArgs,
} from "@/lib/agent-adapter";
import {
  createOpenCodeHttpSession,
} from "@/lib/opencode-http-session";
import {
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
  );
}

export function createTakeTransportSessions(
  isJsonRpc: boolean,
  isHttpServer: boolean,
  isAcp: boolean,
  cwd: string,
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
  );
  return { jsonrpcSession, acpSession, httpSession };
}

export function buildSpawnArgs(
  agent: CliAgentTarget,
  dialect: import("@/lib/agent-adapter").AgentDialect,
  isInteractive: boolean,
  isJsonRpc: boolean,
  isHttpServer: boolean,
  isAcp: boolean,
  takePrompt: string,
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
    cmd = agent.command;
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
    const built = buildPromptModeArgs(
      agent,
      takePrompt,
    );
    cmd = built.command;
    args = built.args;
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
    runtime.dispose();
    takeChild.stdout?.removeAllListeners();
    takeChild.stderr?.removeAllListeners();
    ctx.entry.process = null;
    console.log(
      `[terminal-manager] [${ctx.id}] [take-loop]` +
      ` child close: code=${takeCode}` +
      ` iteration=${ctx.takeIteration.value}` +
      ` beat=${ctx.beatId}` +
      ` aborted=${ctx.sessionAborted()}`,
    );
    recordTakeLoopLifecycle(ctx, "child_close", {
      claimedState: beatState,
      childExitCode: takeCode,
      childSignal: signal,
    });
    handleTakeIterationClose(
      ctx,
      takeCode,
      effectiveAgent,
      beatState ?? "unknown",
    ).catch((err) => {
      console.error(
        `[terminal-manager] [${ctx.id}] ` +
        `[take-loop] handleTakeIterationClose error:`,
        err,
      );
      ctx.finishSession(takeCode ?? 1);
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
    console.error(
      `[terminal-manager] [${ctx.id}] ` +
      `[take-loop] spawn error:`,
      err.message,
    );
    recordTakeLoopLifecycle(ctx, "spawn_error", {
      claimedState: beatState,
      spawnErrorMessage: err.message,
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
