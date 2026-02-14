import { create } from "zustand";
import type {
  BeadStatus,
  BeadType,
  BeadPriority,
  RegisteredRepo,
} from "@/lib/types";

interface Filters {
  status?: BeadStatus | "ready";
  type?: BeadType;
  priority?: BeadPriority;
  assignee?: string;
}

const ACTIVE_REPO_KEY = "foolery-active-repo";

function getStoredActiveRepo(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_REPO_KEY);
}

interface AppState {
  filters: Filters;
  commandPaletteOpen: boolean;
  viewMode: "table" | "board";
  activeRepo: string | null;
  registeredRepos: RegisteredRepo[];
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  resetFilters: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setViewMode: (mode: "table" | "board") => void;
  setActiveRepo: (repo: string | null) => void;
  setRegisteredRepos: (repos: RegisteredRepo[]) => void;
}

const initialFilters: Filters = {};

export const useAppStore = create<AppState>((set) => ({
  filters: initialFilters,
  commandPaletteOpen: false,
  viewMode: "table",
  activeRepo: getStoredActiveRepo(),
  registeredRepos: [],
  setFilter: (key, value) =>
    set((state) => ({
      filters: { ...state.filters, [key]: value },
    })),
  resetFilters: () => set({ filters: initialFilters }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
  setViewMode: (mode) => set({ viewMode: mode }),
  setActiveRepo: (repo) => {
    if (typeof window !== "undefined") {
      if (repo) localStorage.setItem(ACTIVE_REPO_KEY, repo);
      else localStorage.removeItem(ACTIVE_REPO_KEY);
    }
    set({ activeRepo: repo });
  },
  setRegisteredRepos: (repos) => set({ registeredRepos: repos }),
}));
