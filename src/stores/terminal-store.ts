import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TerminalSession, TerminalSessionStatus } from "@/lib/types";

export interface ActiveTerminal {
  sessionId: string;
  beatId: string;
  beatTitle: string;
  beatIds?: string[];
  repoPath?: string;
  agentName?: string;
  agentModel?: string;
  agentVersion?: string;
  agentCommand?: string;
  status: TerminalSessionStatus;
  startedAt: string;
}

export interface QueuedBeat {
  beatId: string;
  beatTitle: string;
  repoPath?: string;
}

interface TerminalState {
  panelOpen: boolean;
  panelMinimized: boolean;
  panelHeight: number; // vh percentage
  terminals: ActiveTerminal[];
  activeSessionId: string | null;
  pendingClose: Set<string>;
  sceneQueue: QueuedBeat[];
  openPanel: () => void;
  closePanel: () => void;
  clearTerminals: () => void;
  togglePanel: () => void;
  minimizePanel: () => void;
  restorePanel: () => void;
  setPanelHeight: (height: number) => void;
  upsertTerminal: (terminal: ActiveTerminal) => void;
  removeTerminal: (sessionId: string) => void;
  setActiveSession: (sessionId: string) => void;
  updateStatus: (sessionId: string, status: TerminalSessionStatus) => void;
  markPendingClose: (sessionId: string) => void;
  cancelPendingClose: (sessionId: string) => void;
  enqueueSceneBeats: (items: QueuedBeat[]) => void;
  dequeueSceneBeats: (count: number) => QueuedBeat[];
  clearSceneQueue: () => void;
  rehydrateFromBackend: (backendSessions: TerminalSession[]) => void;
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set, get) => ({
  panelOpen: false,
  panelMinimized: false,
  panelHeight: 35,
  terminals: [],
  activeSessionId: null,
  pendingClose: new Set<string>(),
  sceneQueue: [],
  openPanel: () => set({ panelOpen: true, panelMinimized: false }),
  closePanel: () =>
    set((s) => {
      const hasRunning = s.terminals.some((t) => t.status === "running");
      if (hasRunning) {
        return { panelOpen: false, panelMinimized: true };
      }
      return { panelOpen: false, panelMinimized: false };
    }),
  clearTerminals: () =>
    set({ terminals: [], activeSessionId: null, panelMinimized: false, pendingClose: new Set() }),
  togglePanel: () =>
    set((s) => {
      if (s.panelMinimized) {
        return { panelOpen: true, panelMinimized: false };
      }
      if (s.panelOpen) {
        const hasRunning = s.terminals.some((t) => t.status === "running");
        if (hasRunning) {
          return { panelOpen: false, panelMinimized: true };
        }
        return { panelOpen: false, panelMinimized: false };
      }
      return { panelOpen: true, panelMinimized: false };
    }),
  minimizePanel: () => set({ panelOpen: false, panelMinimized: true }),
  restorePanel: () => set({ panelOpen: true, panelMinimized: false }),
  setPanelHeight: (height) => set({ panelHeight: Math.max(15, Math.min(80, height)) }),
  upsertTerminal: (terminal) =>
    set((state) => {
      const existingIndex = state.terminals.findIndex(
        (item) => item.sessionId === terminal.sessionId
      );
      const terminals =
        existingIndex === -1
          ? [...state.terminals, terminal]
          : state.terminals.map((item) =>
              item.sessionId === terminal.sessionId ? terminal : item
            );
      return {
        terminals,
        activeSessionId: terminal.sessionId,
        panelOpen: true,
        panelMinimized: false,
      };
    }),
  removeTerminal: (sessionId) =>
    set((state) => {
      const terminals = state.terminals.filter(
        (item) => item.sessionId !== sessionId
      );
      const isRemovingActive = state.activeSessionId === sessionId;
      const nextActiveSessionId = isRemovingActive
        ? (terminals.at(-1)?.sessionId ?? null)
        : state.activeSessionId;
      const pendingClose = new Set(state.pendingClose);
      pendingClose.delete(sessionId);

      return {
        terminals,
        activeSessionId: nextActiveSessionId,
        panelOpen: terminals.length > 0 && state.panelOpen,
        panelMinimized: terminals.length > 0 && state.panelMinimized,
        pendingClose,
      };
    }),
  setActiveSession: (sessionId) =>
    set((state) => {
      const exists = state.terminals.some((item) => item.sessionId === sessionId);
      if (!exists) return {};
      const pendingClose = new Set(state.pendingClose);
      pendingClose.delete(sessionId);
      return {
        activeSessionId: sessionId,
        panelOpen: true,
        panelMinimized: false,
        pendingClose,
      };
    }),
  updateStatus: (sessionId, status) =>
    set((state) => {
      let changed = false;
      const terminals = state.terminals.map((item) => {
        if (item.sessionId !== sessionId) return item;
        if (item.status === status) return item;
        changed = true;
        return { ...item, status };
      });
      return changed ? { terminals } : state;
    }),
  markPendingClose: (sessionId) =>
    set((state) => {
      const pendingClose = new Set(state.pendingClose);
      pendingClose.add(sessionId);
      return { pendingClose };
    }),
  cancelPendingClose: (sessionId) =>
    set((state) => {
      if (!state.pendingClose.has(sessionId)) return state;
      const pendingClose = new Set(state.pendingClose);
      pendingClose.delete(sessionId);
      return { pendingClose };
    }),
  enqueueSceneBeats: (items) =>
    set((state) => ({ sceneQueue: [...state.sceneQueue, ...items] })),
  dequeueSceneBeats: (count) => {
    const current = get().sceneQueue;
    const taken = current.slice(0, count);
    set({ sceneQueue: current.slice(count) });
    return taken;
  },
  clearSceneQueue: () => set({ sceneQueue: [] }),
  rehydrateFromBackend: (backendSessions) =>
    set((state) => {
      const backendMap = new Map(backendSessions.map((s) => [s.id, s]));
      // Sync persisted terminals with backend state
      const synced = state.terminals.map((t) => {
        const backend = backendMap.get(t.sessionId);
        if (!backend) {
          // Terminal gone from backend — server likely restarted; mark disconnected, not completed
          return t.status === "running" ? { ...t, status: "disconnected" as const } : t;
        }
        // Sync backend-authoritative fields for known sessions.
        if (backend.status !== t.status || backend.startedAt !== t.startedAt) {
          return { ...t, status: backend.status, startedAt: backend.startedAt };
        }
        return t;
      });
      // Add orphaned backend sessions not in frontend state
      const knownIds = new Set(state.terminals.map((t) => t.sessionId));
      const orphans: ActiveTerminal[] = backendSessions
        .filter((s) => !knownIds.has(s.id) && s.status === "running")
        .map((s) => ({
          sessionId: s.id,
          beatId: s.beatId,
          beatTitle: s.beatTitle,
          beatIds: s.beatIds,
          repoPath: s.repoPath,
          agentName: s.agentName,
          agentModel: s.agentModel,
          ...(s.agentVersion ? { agentVersion: s.agentVersion } : {}),
          agentCommand: s.agentCommand,
          status: s.status,
          startedAt: s.startedAt,
        }));
      const terminals = [...synced, ...orphans];
      // Fix activeSessionId if it points to a removed terminal
      const activeValid = terminals.some((t) => t.sessionId === state.activeSessionId);
      return {
        terminals,
        activeSessionId: activeValid
          ? state.activeSessionId
          : (terminals.at(-1)?.sessionId ?? null),
      };
    }),
    }),
    {
      name: "foolery:terminal-store",
      version: 1,
      partialize: (state) => ({
        terminals: state.terminals,
        activeSessionId: state.activeSessionId,
        panelOpen: state.panelOpen,
        panelMinimized: state.panelMinimized,
        panelHeight: state.panelHeight,
      }),
    },
  ),
);

export function getActiveTerminal(
  terminals: ActiveTerminal[],
  activeSessionId: string | null
): ActiveTerminal | null {
  if (!activeSessionId) return null;
  return terminals.find((item) => item.sessionId === activeSessionId) ?? null;
}
