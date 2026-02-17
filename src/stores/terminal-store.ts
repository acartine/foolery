import { create } from "zustand";
import type { TerminalSessionStatus } from "@/lib/types";

export interface ActiveTerminal {
  sessionId: string;
  beadId: string;
  beadTitle: string;
  beadIds?: string[];
  repoPath?: string;
  status: TerminalSessionStatus;
  startedAt: string;
}

interface TerminalState {
  panelOpen: boolean;
  panelHeight: number; // vh percentage
  terminals: ActiveTerminal[];
  activeSessionId: string | null;
  pendingClose: Set<string>;
  openPanel: () => void;
  closePanel: () => void;
  clearTerminals: () => void;
  togglePanel: () => void;
  setPanelHeight: (height: number) => void;
  upsertTerminal: (terminal: ActiveTerminal) => void;
  removeTerminal: (sessionId: string) => void;
  setActiveSession: (sessionId: string) => void;
  updateStatus: (sessionId: string, status: TerminalSessionStatus) => void;
  markPendingClose: (sessionId: string) => void;
  cancelPendingClose: (sessionId: string) => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  panelOpen: false,
  panelHeight: 35,
  terminals: [],
  activeSessionId: null,
  pendingClose: new Set<string>(),
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  clearTerminals: () => set({ terminals: [], activeSessionId: null, pendingClose: new Set() }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
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
}));

export function getActiveTerminal(
  terminals: ActiveTerminal[],
  activeSessionId: string | null
): ActiveTerminal | null {
  if (!activeSessionId) return null;
  return terminals.find((item) => item.sessionId === activeSessionId) ?? null;
}
