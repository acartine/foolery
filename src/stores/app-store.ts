import { create } from "zustand";
import type { RegisteredRepo } from "@/lib/types";

export interface Filters {
  state?: string;
  type?: string;
  priority?: number;
  assignee?: string;
}

interface AppState {
  filters: Filters;
  commandPaletteOpen: boolean;
  viewMode: "table" | "board";
  activeRepo: string | null;
  registeredRepos: RegisteredRepo[];
  pageSize: number;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  setFiltersFromUrl: (filters: Filters) => void;
  resetFilters: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setViewMode: (mode: "table" | "board") => void;
  setActiveRepo: (repo: string | null) => void;
  setRegisteredRepos: (repos: RegisteredRepo[]) => void;
  setPageSize: (size: number) => void;
}

const initialFilters: Filters = { state: "queued" };

const LAST_REPO_KEY = "foolery:lastRepo";

function getPersistedRepo(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(LAST_REPO_KEY);
  } catch {
    return null;
  }
}

function persistRepo(repo: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (repo) localStorage.setItem(LAST_REPO_KEY, repo);
    else localStorage.removeItem(LAST_REPO_KEY);
  } catch {
    // localStorage unavailable
  }
}

export const useAppStore = create<AppState>((set) => ({
  filters: initialFilters,
  commandPaletteOpen: false,
  viewMode: "table",
  activeRepo: null,
  registeredRepos: [],
  pageSize: 50,
  setFilter: (key, value) =>
    set((state) => {
      const filters = { ...state.filters, [key]: value };
      return { filters };
    }),
  setFiltersFromUrl: (filters) => set({ filters }),
  resetFilters: () => set({ filters: initialFilters }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
  setViewMode: (mode) => set({ viewMode: mode }),
  setActiveRepo: (repo) => {
    persistRepo(repo);
    set({ activeRepo: repo });
  },
  setRegisteredRepos: (repos) => set({ registeredRepos: repos }),
  setPageSize: (size) => set({ pageSize: size }),
}));

export { getPersistedRepo };
