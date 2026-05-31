import type { FoolerySettings } from "@/lib/schemas";

/** Partial shape accepted by updateSettings for deep merging. */
export type SettingsPartial = Partial<{
  agents: FoolerySettings["agents"];
  actions: Partial<FoolerySettings["actions"]>;
  backend: Partial<FoolerySettings["backend"]>;
  defaults: Partial<FoolerySettings["defaults"]>;
  scopeRefinement: Partial<FoolerySettings["scopeRefinement"]>;
  agentRuntime: {
    codex?: Partial<FoolerySettings["agentRuntime"]["codex"]>;
    claude?: Partial<FoolerySettings["agentRuntime"]["claude"]>;
  };
  pools: Partial<FoolerySettings["pools"]>;
  dispatchMode: FoolerySettings["dispatchMode"];
  maxConcurrentSessions: FoolerySettings["maxConcurrentSessions"];
  maxClaimsPerQueueType: FoolerySettings["maxClaimsPerQueueType"];
  terminalLightTheme: FoolerySettings["terminalLightTheme"];
  autoSync: FoolerySettings["autoSync"];
}>;
