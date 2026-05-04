import { create } from "zustand";
import type {
  PendingBeatRelease,
} from "@/lib/beat-release-optimism";

interface ReleasePendingState {
  pendingReleases: Map<string, PendingBeatRelease>;
  markPendingRelease: (release: PendingBeatRelease) => void;
  clearPendingRelease: (key: string) => void;
}

export const useReleasePendingStore =
  create<ReleasePendingState>((set) => ({
    pendingReleases: new Map(),
    markPendingRelease: (release) =>
      set((state) => {
        const existing = state.pendingReleases.get(release.key);
        if (existing === release) return state;
        const next = new Map(state.pendingReleases);
        next.set(release.key, release);
        return { pendingReleases: next };
      }),
    clearPendingRelease: (key) =>
      set((state) => {
        if (!state.pendingReleases.has(key)) return state;
        const next = new Map(state.pendingReleases);
        next.delete(key);
        return { pendingReleases: next };
      }),
  }));
