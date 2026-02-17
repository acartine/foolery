import { create } from "zustand";
import type {
  BeadStatus,
  BeadType,
  BeadPriority,
  RegisteredRepo,
} from "@/lib/types";

const ACTIVE_REPO_KEY = "foolery-active-repo";

function persistActiveRepo(repo: string | null) {
  if (typeof window === "undefined") return;
  if (repo) localStorage.setItem(ACTIVE_REPO_KEY, repo);
  else localStorage.removeItem(ACTIVE_REPO_KEY);
}

/** Read persisted repo (client only). */
export function getStoredActiveRepo(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_REPO_KEY);
}

export interface Filters {
  status?: BeadStatus | "ready";
  type?: BeadType;
  priority?: BeadPriority;
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

const initialFilters: Filters = { status: "ready" };

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
    persistActiveRepo(repo);
    set({ activeRepo: repo });
  },
  setRegisteredRepos: (repos) => set({ registeredRepos: repos }),
  setPageSize: (size) => set({ pageSize: size }),
}));
