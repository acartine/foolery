import { create } from "zustand";
import type { BeadStatus, BeadType, BeadPriority } from "@/lib/types";

interface Filters {
  status?: BeadStatus;
  type?: BeadType;
  priority?: BeadPriority;
  assignee?: string;
}

interface AppState {
  filters: Filters;
  commandPaletteOpen: boolean;
  viewMode: "table" | "board";
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  resetFilters: () => void;
  toggleCommandPalette: () => void;
  setViewMode: (mode: "table" | "board") => void;
}

const initialFilters: Filters = {};

export const useAppStore = create<AppState>((set) => ({
  filters: initialFilters,
  commandPaletteOpen: false,
  viewMode: "table",
  setFilter: (key, value) =>
    set((state) => ({
      filters: { ...state.filters, [key]: value },
    })),
  resetFilters: () => set({ filters: initialFilters }),
  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
  setViewMode: (mode) => set({ viewMode: mode }),
}));
