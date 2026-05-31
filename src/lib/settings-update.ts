import type { FoolerySettings } from "@/lib/schemas";
import type { SettingsPartial } from "@/lib/settings-types";

export function mergeSettingsPartial(
  current: FoolerySettings,
  partial: SettingsPartial,
): FoolerySettings {
  return {
    ...current,
    agents: partial.agents !== undefined
      ? { ...current.agents, ...partial.agents }
      : current.agents,
    actions: partial.actions !== undefined
      ? { ...current.actions, ...partial.actions }
      : current.actions,
    backend: partial.backend !== undefined
      ? { ...current.backend, ...partial.backend }
      : current.backend,
    defaults: partial.defaults !== undefined
      ? { ...current.defaults, ...partial.defaults }
      : current.defaults,
    scopeRefinement: partial.scopeRefinement !== undefined
      ? { ...current.scopeRefinement, ...partial.scopeRefinement }
      : current.scopeRefinement,
    // Per-sub-object merge: patching `agentRuntime.claude` must not clobber a
    // previously-saved `agentRuntime.codex`, and vice versa.
    agentRuntime: partial.agentRuntime !== undefined
      ? {
        codex: partial.agentRuntime.codex !== undefined
          ? { ...current.agentRuntime.codex, ...partial.agentRuntime.codex }
          : current.agentRuntime.codex,
        claude: partial.agentRuntime.claude !== undefined
          ? { ...current.agentRuntime.claude, ...partial.agentRuntime.claude }
          : current.agentRuntime.claude,
      }
      : current.agentRuntime,
    pools: partial.pools !== undefined
      ? {
        ...current.pools,
        ...partial.pools,
      }
      : current.pools,
    dispatchMode: partial.dispatchMode !== undefined
      ? partial.dispatchMode
      : current.dispatchMode,
    maxConcurrentSessions:
      partial.maxConcurrentSessions !== undefined
        ? partial.maxConcurrentSessions
        : current.maxConcurrentSessions,
    maxClaimsPerQueueType:
      partial.maxClaimsPerQueueType !== undefined
        ? partial.maxClaimsPerQueueType
        : current.maxClaimsPerQueueType,
    terminalLightTheme:
      partial.terminalLightTheme !== undefined
        ? partial.terminalLightTheme
        : current.terminalLightTheme,
    autoSync:
      partial.autoSync !== undefined
        ? partial.autoSync
        : current.autoSync,
  };
}
