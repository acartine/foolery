import {
  createLineNormalizer,
} from "@/lib/agent-adapter";
import {
  resolveCapabilities,
} from "@/lib/agent-session-capabilities";
import {
  createOpenCodeHttpSession,
} from "@/lib/opencode-http-session";
import type { InteractionLog } from "@/lib/interaction-logger";
import type {
  SessionRuntimeConfig,
} from "@/lib/agent-session-runtime";
import type {
  TerminalEvent,
} from "@/lib/types";

type InitialChildState = import(
  "@/lib/terminal-manager-initial-io"
).InitialChildState;

function createStateRef(): { current: InitialChildState } {
  return { current: {} as InitialChildState };
}

function createHttpSession(
  isHttpServer: boolean,
  stateRef: { current: InitialChildState },
  pushEvent: (evt: TerminalEvent) => void,
) {
  if (!isHttpServer) return undefined;
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
  );
}

export function createInitialRuntime(
  id: string,
  dialect: import("@/lib/agent-adapter").AgentDialect,
  capabilities: ReturnType<typeof resolveCapabilities>,
  normalizeEvent: ReturnType<
    typeof createLineNormalizer
  >,
  pushEvent: (evt: TerminalEvent) => void,
  interactionLog: InteractionLog,
  beatId: string,
  jsonrpcSession?: import(
    "@/lib/codex-jsonrpc-session"
  ).CodexJsonRpcSession,
  acpSession?: import(
    "@/lib/gemini-acp-session"
  ).GeminiAcpSession,
) {
  const sessionBeatIds = [beatId];
  const stateRef = createStateRef();
  const httpSession = createHttpSession(
    capabilities.promptTransport === "http-server",
    stateRef,
    pushEvent,
  );
  const runtimeConfig: SessionRuntimeConfig = {
    id,
    dialect,
    capabilities,
    normalizeEvent,
    pushEvent,
    interactionLog,
    beatIds: sessionBeatIds,
    jsonrpcSession,
    httpSession,
    acpSession,
  };
  return {
    sessionBeatIds,
    stateRef,
    runtimeConfig,
  };
}
