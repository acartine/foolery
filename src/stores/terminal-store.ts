import { create } from "zustand";
import type { TerminalSessionStatus } from "@/lib/types";

interface ActiveTerminal {
  sessionId: string;
  beadId: string;
  beadTitle: string;
  status: TerminalSessionStatus;
}

interface TerminalState {
  panelOpen: boolean;
  panelHeight: number; // vh percentage
  activeTerminal: ActiveTerminal | null;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  setPanelHeight: (height: number) => void;
  setActiveTerminal: (terminal: ActiveTerminal | null) => void;
  updateStatus: (status: TerminalSessionStatus) => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  panelOpen: false,
  panelHeight: 35,
  activeTerminal: null,
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false, activeTerminal: null }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPanelHeight: (height) => set({ panelHeight: Math.max(15, Math.min(80, height)) }),
  setActiveTerminal: (terminal) => set({ activeTerminal: terminal, panelOpen: true }),
  updateStatus: (status) =>
    set((s) =>
      s.activeTerminal
        ? { activeTerminal: { ...s.activeTerminal, status } }
        : {}
    ),
}));
