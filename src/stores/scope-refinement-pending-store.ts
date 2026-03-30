import { create } from "zustand";

interface ScopeRefinementPendingState {
  pendingBeatIds: Set<string>;
  markPending: (beatId: string) => void;
  markComplete: (beatId: string) => void;
}

export const useScopeRefinementPendingStore =
  create<ScopeRefinementPendingState>((set) => ({
    pendingBeatIds: new Set(),
    markPending: (beatId) =>
      set((state) => {
        if (state.pendingBeatIds.has(beatId))
          return state;
        const next = new Set(state.pendingBeatIds);
        next.add(beatId);
        return { pendingBeatIds: next };
      }),
    markComplete: (beatId) =>
      set((state) => {
        if (!state.pendingBeatIds.has(beatId))
          return state;
        const next = new Set(state.pendingBeatIds);
        next.delete(beatId);
        return { pendingBeatIds: next };
      }),
  }));

export function selectIsPending(
  beatId: string,
): (state: ScopeRefinementPendingState) => boolean {
  return (state) => state.pendingBeatIds.has(beatId);
}
