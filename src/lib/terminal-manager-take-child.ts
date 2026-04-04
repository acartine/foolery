/**
 * Take-loop child process spawning and I/O wiring.
 * Delegates line buffering, event normalization,
 * AskUser auto-response, and stdin lifecycle to
 * the shared AgentSessionRuntime.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
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
  createOpenCodeHttpSession,
} from "@/lib/opencode-http-session";
import {
  createGeminiAcpSession,
} from "@/lib/gemini-acp-session";
import {
  createSessionRuntime,
  type AgentSessionRuntime,
} from "@/lib/agent-session-runtime";
import type { CliAgentTarget } from "@/lib/types-agent-target";
import {
  agentDisplayName,
  toExecutionAgentInfo,
} from "@/lib/agent-identity";
import {
  resolveAgentCommand,
} from "@/lib/terminal-manager-types";
import type {
  TakeLoopContext,
} from "@/lib/terminal-manager-take-loop";
import {
  handleTakeIterationClose,
} from "@/lib/terminal-manager-take-loop";

// ─── HTTP session helper ────────────────────────────

interface DeferredHttpRefs {
  childRef: ChildProcess | null;
  runtimeRef: AgentSessionRuntime | null;
}

function createDeferredHttpSession(
  isHttpServer: boolean,
  refs: DeferredHttpRefs,
  pushEvent: TakeLoopContext["pushEvent"],
): import(
  "@/lib/opencode-http-session"
).OpenCodeHttpSession | undefined {
  if (!isHttpServer) return undefined;
  return createOpenCodeHttpSession(
    (jsonLine) => {
      if (refs.runtimeRef && refs.childRef) {
        refs.runtimeRef.injectLine(
          refs.childRef, jsonLine,
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
  );
}

// ─── spawnTakeChild (entry point) ────────────────────

export function spawnTakeChild(
  ctx: TakeLoopContext,
  takePrompt: string,
  beatState?: string,
  agentOverride?: CliAgentTarget,
): void {
  const effectiveAgent =
    agentOverride ?? ctx.agent;
  ctx.agent = effectiveAgent;
  ctx.agentInfo =
    toExecutionAgentInfo(effectiveAgent);
  ctx.session.agentName =
    agentDisplayName(effectiveAgent);
  ctx.session.agentModel = effectiveAgent.model;
  ctx.session.agentVersion =
    effectiveAgent.version;
  ctx.session.agentCommand =
    effectiveAgent.command;
  const effectiveDialect = resolveDialect(
    effectiveAgent.command,
  );
  const preferInteractive =
    supportsInteractive(effectiveDialect);
  const capabilities = resolveCapabilities(
    effectiveDialect, preferInteractive,
  );
  const isInteractive = capabilities.interactive;
  const pt = capabilities.promptTransport;
  const isJsonRpc = pt === "jsonrpc-stdio";
  const isHttpServer = pt === "http-server";
  const isAcp = pt === "acp-stdio";
  const { cmd, args } = buildSpawnArgs(
    effectiveAgent, effectiveDialect,
    isInteractive, isJsonRpc, isHttpServer, isAcp,
    takePrompt,
  );
  const normalizeEvent = createLineNormalizer(
    effectiveDialect,
  );

  const jsonrpcSession = isJsonRpc
    ? createCodexJsonRpcSession() : undefined;
  const acpSession = isAcp
    ? createGeminiAcpSession() : undefined;
  const httpRefs: DeferredHttpRefs = {
    childRef: null, runtimeRef: null,
  };
  const httpSession = createDeferredHttpSession(
    isHttpServer, httpRefs, ctx.pushEvent,
  );
  const runtime = createSessionRuntime({
    id: ctx.id,
    dialect: effectiveDialect,
    capabilities,
    normalizeEvent,
    pushEvent: ctx.pushEvent,
    interactionLog: ctx.interactionLog,
    beatIds: [ctx.beatId],
    jsonrpcSession,
    httpSession,
    acpSession,
  });
  httpRefs.runtimeRef = runtime;

  const takeChild = spawn(cmd, args, {
    cwd: ctx.cwd,
    stdio: [
      isInteractive ? "pipe" : "ignore",
      "pipe", "pipe",
    ],
    detached: true,
  });
  ctx.entry.process = takeChild;
  httpRefs.childRef = takeChild;

  console.log(
    `[terminal-manager] [${ctx.id}] [take-loop] ` +
    `iteration ${ctx.takeIteration.value}: ` +
    `pid=${takeChild.pid ?? "failed"} ` +
    `beat=${ctx.beatId} ` +
    `beat_state=${beatState ?? "unknown"}`,
  );

  runtime.wireStdout(takeChild);
  runtime.wireStderr(takeChild);
  wireClose(
    ctx, takeChild, runtime,
    effectiveAgent, effectiveDialect,
    beatState,
  );
  wireError(
    ctx, takeChild, runtime,
    effectiveAgent, effectiveDialect, beatState,
  );
  jsonrpcSession?.sendHandshake(takeChild);
  acpSession?.sendHandshake(takeChild);
  logAndSendPrompt(
    ctx, takeChild, runtime,
    isInteractive, effectiveDialect,
    takePrompt, beatState,
  );
}

// ─── Spawn args ──────────────────────────────────────

function buildSpawnArgs(
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
      "-p", "--input-format", "stream-json",
      "--verbose", "--output-format", "stream-json",
      "--dangerously-skip-permissions",
    ];
    if (agent.model) {
      args.push("--model", agent.model);
    }
  } else {
    const built = buildPromptModeArgs(
      agent, takePrompt,
    );
    cmd = built.command;
    args = built.args;
  }
  cmd = resolveAgentCommand(cmd);
  return { cmd, args };
}

// ─── Close / Error ───────────────────────────────────

function wireClose(
  ctx: TakeLoopContext,
  takeChild: ChildProcess,
  runtime: AgentSessionRuntime,
  effectiveAgent: CliAgentTarget,
  _effectiveDialect: string,
  beatState: string | undefined,
): void {
  takeChild.on("close", (takeCode) => {
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

    handleTakeIterationClose(
      ctx, takeCode, effectiveAgent,
      beatState ?? "unknown",
    ).catch((err) => {
      console.error(
        `[terminal-manager] [${ctx.id}] ` +
        `[take-loop] ` +
        `handleTakeIterationClose error:`, err,
      );
      ctx.finishSession(takeCode ?? 1);
    });
  });
}

function wireError(
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
      `[take-loop] spawn error:`, err.message,
    );
    runtime.dispose();
    ctx.pushEvent({
      type: "stderr",
      data: `${errorPrefix} Process error: ` +
        `${err.message}\n`,
      timestamp: Date.now(),
    });
    takeChild.stdout?.removeAllListeners();
    takeChild.stderr?.removeAllListeners();
    ctx.entry.process = null;
    handleTakeIterationClose(
      ctx, 1, effectiveAgent,
      beatState ?? "unknown",
    ).catch((e) => {
      console.error(
        `[terminal-manager] [${ctx.id}] ` +
        `[take-loop] ` +
        `handleTakeIterationClose error ` +
        `after spawn error:`, e,
      );
      ctx.finishSession(1);
    });
  });
}

function logAndSendPrompt(
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

  if (isInteractive) {
    const iter = ctx.takeIteration.value;
    const sent = runtime.sendUserTurn(
      takeChild, takePrompt, `take_${iter}`,
    );
    if (!sent) {
      runtime.closeInput(takeChild);
      const pfx =
        `[take ${iter} ` +
        `| beat: ${ctx.beatId.slice(0, 12)} ` +
        `| agent: ${dialect}]`;
      ctx.pushEvent({
        type: "stderr",
        data: `${pfx} Failed to send prompt ` +
          `— stdin is closed or unavailable.\n`,
        timestamp: Date.now(),
      });
      takeChild.kill("SIGTERM");
      ctx.entry.process = null;
      ctx.finishSession(1);
    }
  } else {
    ctx.interactionLog.logPrompt(takePrompt, {
      source: `take_${ctx.takeIteration.value}`,
    });
  }
}
