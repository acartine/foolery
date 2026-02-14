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
const FILTERS_KEY = "foolery-filters";

function getStoredActiveRepo(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_REPO_KEY);
}

function getStoredFilters(): Filters {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Filters;
  } catch {
    return {};
  }
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

function persistFilters(filters: Filters) {
  if (typeof window === "undefined") return;
  const hasValues = Object.values(filters).some((v) => v !== undefined);
  if (hasValues) localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  else localStorage.removeItem(FILTERS_KEY);
}

export const useAppStore = create<AppState>((set) => ({
  filters: getStoredFilters(),
  commandPaletteOpen: false,
  viewMode: "table",
  activeRepo: getStoredActiveRepo(),
  registeredRepos: [],
  setFilter: (key, value) =>
    set((state) => {
      const filters = { ...state.filters, [key]: value };
      persistFilters(filters);
      return { filters };
    }),
  resetFilters: () => {
    persistFilters(initialFilters);
    return set({ filters: initialFilters });
  },
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
