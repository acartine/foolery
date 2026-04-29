/**
 * Take-loop child process spawning and I/O wiring.
 * Delegates line buffering, event normalization,
 * AskUser auto-response, and stdin lifecycle to
 * the shared AgentSessionRuntime.
 */
import { spawn } from "node:child_process";
import {
  resolveDialect,
  createLineNormalizer,
} from "@/lib/agent-adapter";
import {
  type AgentSessionCapabilities,
} from "@/lib/agent-session-capabilities";
import {
  resolveInteractiveSessionWatchdogTimeoutMs,
} from "@/lib/interactive-session-timeout";
import {
  createSessionRuntime,
  type SessionRuntimeLifecycleEvent,
} from "@/lib/agent-session-runtime";
import type { CliAgentTarget } from "@/lib/types-agent-target";
import {
  toExecutionAgentInfo,
} from "@/lib/agent-identity";
import type {
  TakeLoopContext,
} from "@/lib/terminal-manager-take-loop";
import {
  recordTakeLoopLifecycle,
  runtimeAgentPatch,
} from "@/lib/terminal-manager-take-lifecycle";
import {
  createTakeLoopRuntimeLifecycleHandler,
} from "@/lib/terminal-manager-runtime-lifecycle";
import {
  buildSpawnArgs,
  createTakeTransportSessions,
  type DeferredHttpRefs,
  logAndSendTakePrompt,
  wireTakeChildClose,
  wireTakeChildError,
} from "@/lib/terminal-manager-take-child-helpers";
import {
  handleTakeLoopTurnEnded,
} from "@/lib/terminal-manager-take-follow-up";
import {
  attachApprovalResponder,
  createApprovalRequestHandler,
} from "@/lib/terminal-approval-session";
import {
  resolveTakeSceneCapabilities,
} from "@/lib/terminal-dispatch-capabilities";

// ─── spawnTakeChild (entry point) ────────────────────

function applyEffectiveAgent(
  ctx: TakeLoopContext,
  effectiveAgent: CliAgentTarget,
): void {
  ctx.agent = effectiveAgent;
  ctx.agentInfo =
    toExecutionAgentInfo(effectiveAgent);
  ctx.session.agentName =
    ctx.agentInfo.agentName;
  ctx.session.agentModel = effectiveAgent.model;
  ctx.session.agentVersion =
    effectiveAgent.version;
  ctx.session.agentCommand =
    effectiveAgent.command;
}

export function spawnTakeChild(
  ctx: TakeLoopContext,
  takePrompt: string,
  beatState?: string,
  agentOverride?: CliAgentTarget,
): void {
  const effectiveAgent =
    agentOverride ?? ctx.agent;
  applyEffectiveAgent(ctx, effectiveAgent);
  recordTakeLoopLifecycle(ctx, "prompt_built", {
    claimedState: beatState,
    leaseId: ctx.entry.knotsLeaseId,
    promptLength: takePrompt.length,
    promptSource: `take_${ctx.takeIteration.value}`,
    ...runtimeAgentPatch(effectiveAgent),
  });
  const effectiveDialect = resolveDialect(
    effectiveAgent.command,
  );
  const capabilities = resolveTakeSceneCapabilities(
    effectiveDialect, "take",
  );
  const isInteractive = capabilities.interactive;
  const watchdogTimeoutMs =
    resolveInteractiveSessionWatchdogTimeoutMs(
      isInteractive,
      ctx.interactiveSessionTimeoutMinutes,
    );
  const pt = capabilities.promptTransport;
  const isJsonRpc = pt === "jsonrpc-stdio";
  const isHttpServer = pt === "http-server";
  const isAcp = pt === "acp-stdio";
  const { cmd, args } = buildSpawnArgs(
    effectiveAgent, effectiveDialect,
    "take", isInteractive, isJsonRpc,
    isHttpServer, isAcp,
  );
  const {
    runtime,
    httpRefs,
    jsonrpcSession,
    acpSession,
  } = createTakeRuntimeBundle(
    ctx,
    beatState,
    effectiveDialect,
    capabilities,
    watchdogTimeoutMs,
    isJsonRpc,
    isHttpServer,
    isAcp,
  );

  const takeChild = spawn(cmd, args, {
    cwd: ctx.cwd,
    env: approvalBridgeEnv(ctx.entry, ctx.id),
    stdio: [
      isInteractive ? "pipe" : "ignore",
      "pipe", "pipe",
    ],
    detached: true,
  });
  ctx.entry.process = takeChild;
  attachApprovalResponder(ctx.entry, runtime);
  httpRefs.childRef = takeChild;

  console.log(
    `[terminal-manager] [${ctx.id}] [take-loop] ` +
    `iteration ${ctx.takeIteration.value}: ` +
    `pid=${takeChild.pid ?? "failed"} ` +
    `beat=${ctx.beatId} ` +
    `beat_state=${beatState ?? "unknown"}`,
  );
  recordTakeLoopLifecycle(ctx, "child_spawned", {
    claimedState: beatState,
    leaseId: ctx.entry.knotsLeaseId,
    childPid: takeChild.pid,
  });

  runtime.wireStdout(takeChild);
  runtime.wireStderr(takeChild);
  wireTakeChildClose(
    ctx, takeChild, runtime,
    effectiveAgent,
    beatState,
  );
  wireTakeChildError(
    ctx, takeChild, runtime,
    effectiveAgent, effectiveDialect, beatState,
  );
  jsonrpcSession?.sendHandshake(takeChild);
  acpSession?.sendHandshake(takeChild);
  logAndSendTakePrompt(
    ctx, takeChild, runtime,
    isInteractive, effectiveDialect,
    takePrompt, beatState,
  );
}

/**
 * Exported for the foolery-6881 wiring canary test.
 * Do not call directly from production code paths —
 * use `spawnTakeChild`.
 */
export function createTakeRuntimeBundle(
  ctx: TakeLoopContext,
  beatState: string | undefined,
  effectiveDialect: import("@/lib/agent-adapter").AgentDialect,
  capabilities: AgentSessionCapabilities,
  watchdogTimeoutMs: number | null,
  isJsonRpc: boolean,
  isHttpServer: boolean,
  isAcp: boolean,
) {
  const handleLifecycleEvent =
    createTakeLoopRuntimeLifecycleHandler(
      ctx,
      beatState,
    );
  const emitRuntimeLifecycle = (
    event: SessionRuntimeLifecycleEvent,
  ) => handleLifecycleEvent(event);
  const httpRefs: DeferredHttpRefs = {
    childRef: null,
    runtimeRef: null,
  };
  const sessions = createTakeTransportSessions(
    isJsonRpc,
    isHttpServer,
    isAcp,
    ctx.cwd,
    ctx.agent.model,
    ctx.agent.approvalMode,
    httpRefs,
    ctx.pushEvent,
    emitRuntimeLifecycle,
  );
  const runtime = createSessionRuntime({
    id: ctx.id,
    dialect: effectiveDialect,
    capabilities,
    watchdogTimeoutMs,
    normalizeEvent: createLineNormalizer(
      effectiveDialect,
    ),
    pushEvent: ctx.pushEvent,
    interactionLog: ctx.interactionLog,
    beatIds: [ctx.beatId],
    onLifecycleEvent: handleLifecycleEvent,
    onApprovalRequest:
      createApprovalRequestHandler(ctx.entry),
    // foolery-6881: every take iteration must get the
    // same in-session follow-up capability the initial
    // child has (foolery-a401). Without this wiring, a
    // turn ending on take 2+ would close stdin and exit
    // even when the beat is still in an active state.
    onTurnEnded: () =>
      invokeTakeLoopTurnEnded(ctx, httpRefs),
    jsonrpcSession: sessions.jsonrpcSession,
    httpSession: sessions.httpSession,
    acpSession: sessions.acpSession,
  });
  httpRefs.runtimeRef = runtime;
  return {
    runtime,
    httpRefs,
    jsonrpcSession: sessions.jsonrpcSession,
    acpSession: sessions.acpSession,
  };
}

/**
 * Bridges the runtime's `onTurnEnded` callback to the
 * async take-loop follow-up handler. Returns a Promise
 * so the runtime suppresses its grace-period close
 * until the handler resolves. The runtime also tolerates
 * a synchronous `false` if refs aren't wired yet (belt
 * and suspenders — httpRefs are populated by the time
 * the runtime emits turn-ended).
 */
function invokeTakeLoopTurnEnded(
  ctx: TakeLoopContext,
  httpRefs: DeferredHttpRefs,
): Promise<boolean> {
  const runtime = httpRefs.runtimeRef;
  const child = httpRefs.childRef;
  if (!runtime || !child) {
    return Promise.resolve(false);
  }
  return handleTakeLoopTurnEnded(ctx, runtime, child);
}

function approvalBridgeEnv(
  entry: TakeLoopContext["entry"],
  sessionId: string,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FOOLERY_TERMINAL_SESSION_ID: sessionId,
    FOOLERY_APPROVAL_BRIDGE_BASE_URL:
      entry.approvalBridgeBaseUrl ?? "",
    FOOLERY_APPROVAL_BRIDGE_TOKEN:
      entry.approvalBridgeToken ?? "",
  };
}
