import type { ScopeRefinementCompletion } from "@/lib/types";

const MAX_SCOPE_REFINEMENT_EVENTS = 50;

interface ScopeRefinementEventState {
  events: ScopeRefinementCompletion[];
  nextId: number;
}

const g = globalThis as typeof globalThis & {
  __scopeRefinementEventState?: ScopeRefinementEventState;
};

function getEventState(): ScopeRefinementEventState {
  if (!g.__scopeRefinementEventState) {
    g.__scopeRefinementEventState = {
      events: [],
      nextId: 1,
    };
  }
  return g.__scopeRefinementEventState;
}

export function recordScopeRefinementCompletion(
  input: Omit<ScopeRefinementCompletion, "id" | "timestamp">,
): ScopeRefinementCompletion {
  const state = getEventState();
  const event: ScopeRefinementCompletion = {
    id: `scope-refinement-completion-${state.nextId++}`,
    beatId: input.beatId,
    beatTitle: input.beatTitle,
    ...(input.repoPath ? { repoPath: input.repoPath } : {}),
    timestamp: Date.now(),
  };
  state.events = [event, ...state.events].slice(0, MAX_SCOPE_REFINEMENT_EVENTS);
  return event;
}

export function listScopeRefinementCompletions(): ScopeRefinementCompletion[] {
  return [...getEventState().events];
}

export function clearScopeRefinementCompletions(): void {
  const state = getEventState();
  state.events = [];
  state.nextId = 1;
}
