import type { FoolerySettings } from "@/lib/schemas";

/** Partial shape accepted by updateSettings for deep merging. */
export type SettingsPartial = Partial<{
  agents: FoolerySettings["agents"];
  actions: Partial<FoolerySettings["actions"]>;
  backend: Partial<FoolerySettings["backend"]>;
  defaults: Partial<FoolerySettings["defaults"]>;
  scopeRefinement: Partial<FoolerySettings["scopeRefinement"]>;
  pools: Partial<FoolerySettings["pools"]>;
  dispatchMode: FoolerySettings["dispatchMode"];
  maxConcurrentSessions: FoolerySettings["maxConcurrentSessions"];
  maxClaimsPerQueueType: FoolerySettings["maxClaimsPerQueueType"];
  terminalLightTheme: FoolerySettings["terminalLightTheme"];
}>;
