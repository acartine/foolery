import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TerminalSession, TerminalSessionStatus } from "@/lib/types";

/**
 * UI-side handle for a running/recent terminal session.
 *
 * Agent identity (name / model / version / provider) is intentionally NOT
 * stored here.  The canonical source is the bound Knots lease; consumers
 * read it via {@link useTerminalAgentInfo} which resolves from the
 * autostamped lease `agent_info` carried back by the terminal API.
 *
 * See `docs/knots-agent-identity-contract.md` rule 5.
 */
export interface ActiveTerminal {
  sessionId: string;
  beatId: string;
  beatTitle: string;
  beatIds?: string[];
  repoPath?: string;
  /**
   * Knots lease bound to this session.  Use as the key into the
   * lease-derived agent-info resolver — never persist the resolved fields
   * here, they belong on the lease.
   */
  knotsLeaseId?: string;
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
  updateLease: (sessionId: string, knotsLeaseId: string | undefined) => void;
  markPendingClose: (sessionId: string) => void;
  cancelPendingClose: (sessionId: string) => void;
  enqueueSceneBeats: (items: QueuedBeat[]) => void;
  dequeueSceneBeats: (count: number) => QueuedBeat[];
  clearSceneQueue: () => void;
  rehydrateFromBackend: (backendSessions: TerminalSession[]) => void;
}

function computeTogglePanel(
  s: Pick<TerminalState, "panelMinimized" | "panelOpen" | "terminals">,
): Partial<TerminalState> {
  if (s.panelMinimized) return { panelOpen: true, panelMinimized: false };
  if (s.panelOpen) {
    const hasRunning = s.terminals.some((t) => t.status === "running");
    if (hasRunning) return { panelOpen: false, panelMinimized: true };
    return { panelOpen: false, panelMinimized: false };
  }
  return { panelOpen: true, panelMinimized: false };
}

function computeUpsertTerminal(
  state: TerminalState,
  terminal: ActiveTerminal,
): Partial<TerminalState> {
  const existingIndex = state.terminals.findIndex(
    (item) => item.sessionId === terminal.sessionId,
  );
  const terminals =
    existingIndex === -1
      ? [...state.terminals, terminal]
      : state.terminals.map((item) =>
          item.sessionId === terminal.sessionId ? terminal : item,
        );
  return {
    terminals,
    activeSessionId: terminal.sessionId,
    panelOpen: true,
    panelMinimized: false,
  };
}

function computeRemoveTerminal(
  state: TerminalState,
  sessionId: string,
): Partial<TerminalState> {
  const terminals = state.terminals.filter(
    (item) => item.sessionId !== sessionId,
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
}

function computeSetActiveSession(
  state: TerminalState,
  sessionId: string,
): Partial<TerminalState> {
  const exists = state.terminals.some(
    (item) => item.sessionId === sessionId,
  );
  if (!exists) return {};
  const pendingClose = new Set(state.pendingClose);
  pendingClose.delete(sessionId);
  return {
    activeSessionId: sessionId,
    panelOpen: true,
    panelMinimized: false,
    pendingClose,
  };
}

function computeUpdateStatus(
  state: TerminalState,
  sessionId: string,
  status: TerminalSessionStatus,
): Partial<TerminalState> | TerminalState {
  let changed = false;
  const terminals = state.terminals.map((item) => {
    if (item.sessionId !== sessionId) return item;
    if (item.status === status) return item;
    changed = true;
    return { ...item, status };
  });
  return changed ? { terminals } : state;
}

function computeRehydrate(
  state: TerminalState,
  backendSessions: TerminalSession[],
): Partial<TerminalState> {
  const backendMap = new Map(
    backendSessions.map((s) => [s.id, s]),
  );
  const synced = state.terminals.map((t) => {
    const backend = backendMap.get(t.sessionId);
    if (!backend) {
      return t.status === "running"
        ? { ...t, status: "disconnected" as const }
        : t;
    }
    const next: ActiveTerminal = {
      ...t,
      status: backend.status,
      startedAt: backend.startedAt,
      ...(backend.knotsLeaseId !== undefined
        ? { knotsLeaseId: backend.knotsLeaseId }
        : {}),
    };
    if (
      backend.status === t.status &&
      backend.startedAt === t.startedAt &&
      backend.knotsLeaseId === t.knotsLeaseId
    ) {
      return t;
    }
    return next;
  });
  const knownIds = new Set(
    state.terminals.map((t) => t.sessionId),
  );
  const orphans: ActiveTerminal[] = backendSessions
    .filter((s) => !knownIds.has(s.id) && s.status === "running")
    .map((s) => ({
      sessionId: s.id,
      beatId: s.beatId,
      beatTitle: s.beatTitle,
      beatIds: s.beatIds,
      repoPath: s.repoPath,
      ...(s.knotsLeaseId ? { knotsLeaseId: s.knotsLeaseId } : {}),
      status: s.status,
      startedAt: s.startedAt,
    }));
  const terminals = [...synced, ...orphans];
  const activeValid = terminals.some(
    (t) => t.sessionId === state.activeSessionId,
  );
  const hasRunningOrphans = orphans.length > 0;
  return {
    terminals,
    activeSessionId: activeValid
      ? state.activeSessionId
      : (terminals.at(-1)?.sessionId ?? null),
    ...(hasRunningOrphans
      ? { panelOpen: true, panelMinimized: false }
      : {}),
  };
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
      if (hasRunning) return { panelOpen: false, panelMinimized: true };
      return { panelOpen: false, panelMinimized: false };
    }),
  clearTerminals: () =>
    set({
      terminals: [],
      activeSessionId: null,
      panelMinimized: false,
      pendingClose: new Set(),
    }),
  togglePanel: () => set((s) => computeTogglePanel(s)),
  minimizePanel: () => set({ panelOpen: false, panelMinimized: true }),
  restorePanel: () => set({ panelOpen: true, panelMinimized: false }),
  setPanelHeight: (height) =>
    set({ panelHeight: Math.max(15, Math.min(80, height)) }),
  upsertTerminal: (terminal) =>
    set((state) => computeUpsertTerminal(state, terminal)),
  removeTerminal: (sessionId) =>
    set((state) => computeRemoveTerminal(state, sessionId)),
  setActiveSession: (sessionId) =>
    set((state) => computeSetActiveSession(state, sessionId)),
  updateStatus: (sessionId, status) =>
    set((state) => computeUpdateStatus(state, sessionId, status)),
  updateLease: (sessionId, knotsLeaseId) =>
    set((state) => ({
      terminals: state.terminals.map((item) =>
        item.sessionId === sessionId
          ? { ...item, knotsLeaseId }
          : item,
      ),
    })),
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
    set((state) => ({
      sceneQueue: [...state.sceneQueue, ...items],
    })),
  dequeueSceneBeats: (count) => {
    const current = get().sceneQueue;
    const taken = current.slice(0, count);
    set({ sceneQueue: current.slice(count) });
    return taken;
  },
  clearSceneQueue: () => set({ sceneQueue: [] }),
  rehydrateFromBackend: (backendSessions) =>
    set((state) => computeRehydrate(state, backendSessions)),
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
