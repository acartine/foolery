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
  pendingRepoScopeKey: string | null;
  registeredRepos: RegisteredRepo[];
  pageSize: number;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  setFiltersFromUrl: (filters: Filters) => void;
  resetFilters: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setViewMode: (mode: "table" | "board") => void;
  setActiveRepo: (repo: string | null) => void;
  setPendingRepoScopeKey: (
    scopeKey: string | null,
  ) => void;
  setRegisteredRepos: (repos: RegisteredRepo[]) => void;
  setPageSize: (size: number) => void;
}

const initialFilters: Filters = { state: "queued" };

const LAST_REPO_KEY = "foolery:lastRepo";
const ALL_REPOS_SENTINEL = "__ALL_REPOSITORIES__";

type PersistedRepoSelection =
  | { kind: "repo"; path: string }
  | { kind: "all" };

function getPersistedRepoSelection(): PersistedRepoSelection | null {
  if (typeof window === "undefined") return null;
  try {
    const persisted = localStorage.getItem(LAST_REPO_KEY);
    if (!persisted) return null;
    if (persisted === ALL_REPOS_SENTINEL) {
      return { kind: "all" };
    }
    return { kind: "repo", path: persisted };
  } catch {
    return null;
  }
}

function getPersistedRepo(): string | null {
  const persisted = getPersistedRepoSelection();
  return persisted?.kind === "repo" ? persisted.path : null;
}

function persistRepo(repo: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (repo) localStorage.setItem(LAST_REPO_KEY, repo);
    else localStorage.setItem(LAST_REPO_KEY, ALL_REPOS_SENTINEL);
  } catch {
    // localStorage unavailable
  }
}

export const useAppStore = create<AppState>((set) => ({
  filters: initialFilters,
  commandPaletteOpen: false,
  viewMode: "table",
  activeRepo: null,
  pendingRepoScopeKey: null,
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
  setPendingRepoScopeKey: (scopeKey) =>
    set({ pendingRepoScopeKey: scopeKey }),
  setRegisteredRepos: (repos) => set({ registeredRepos: repos }),
  setPageSize: (size) => set({ pageSize: size }),
}));

export { getPersistedRepo, getPersistedRepoSelection, LAST_REPO_KEY };
