import type {
  AgentDialect,
} from "@/lib/agent-adapter";
import {
  resolveCapabilities,
  supportsInteractive,
  type AgentSessionCapabilities,
} from "@/lib/agent-session-capabilities";
import {
  resolveInteractiveSessionWatchdogTimeoutMs,
} from "@/lib/interactive-session-timeout";
import type {
  TerminalEvent,
} from "@/lib/types";

export const TERMINAL_DISPATCH_FAILURE_MARKER =
  "FOOLERY DISPATCH FAILURE";

export type TerminalDispatchKind = "take" | "scene";

export function terminalDispatchKind(
  effectiveParent: boolean,
): TerminalDispatchKind {
  return effectiveParent ? "scene" : "take";
}

export function resolveTakeSceneCapabilities(
  dialect: AgentDialect,
  dispatchKind: TerminalDispatchKind,
): AgentSessionCapabilities {
  const capabilities = resolveCapabilities(
    dialect,
    supportsInteractive(dialect),
  );
  assertTakeSceneInteractiveCapabilities(
    dialect,
    dispatchKind,
    capabilities,
  );
  return capabilities;
}

export function resolveTakeSceneRuntimeSelection(
  dialect: AgentDialect,
  dispatchKind: TerminalDispatchKind,
  interactiveSessionTimeoutMinutes: number,
) {
  const capabilities = resolveTakeSceneCapabilities(
    dialect, dispatchKind,
  );
  return {
    capabilities,
    isInteractive: capabilities.interactive,
    transport: capabilities.promptTransport,
    watchdogTimeoutMs:
      resolveInteractiveSessionWatchdogTimeoutMs(
        capabilities.interactive,
        interactiveSessionTimeoutMinutes,
      ),
  };
}

export function assertTakeSceneInteractiveCapabilities(
  dialect: AgentDialect,
  dispatchKind: TerminalDispatchKind,
  capabilities: AgentSessionCapabilities,
): void {
  if (
    capabilities.interactive &&
    capabilities.promptTransport !== "cli-arg"
  ) {
    return;
  }
  throw new Error(
    formatTakeSceneOneShotFailure(
      dialect,
      dispatchKind,
      capabilities.promptTransport,
    ),
  );
}

export function formatTakeSceneOneShotFailure(
  dialect: AgentDialect,
  dispatchKind: TerminalDispatchKind,
  transport: string,
): string {
  return `${TERMINAL_DISPATCH_FAILURE_MARKER}: ` +
    `${dispatchKind} dispatch for ${dialect} resolved to ` +
    `${transport} transport. One-shot cli-arg execution is ` +
    "forbidden for take and scene sessions. Configure an " +
    "interactive agent transport for this provider.";
}

export function emitTerminalDispatchFailure(
  pushEvent: (evt: TerminalEvent) => void,
  message: string,
): void {
  const banner = `\x1b[1;31m--- ${message} ---\x1b[0m\n`;
  console.error(banner.trimEnd());
  pushEvent({
    type: "stderr",
    data: banner,
    timestamp: Date.now(),
  });
}
