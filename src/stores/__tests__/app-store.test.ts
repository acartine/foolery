import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock localStorage before importing the module
const localStore = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => localStore.get(key) ?? null,
  setItem: (key: string, value: string) => localStore.set(key, value),
  removeItem: (key: string) => localStore.delete(key),
  clear: () => localStore.clear(),
};

vi.stubGlobal("window", { localStorage: mockLocalStorage });
vi.stubGlobal("localStorage", mockLocalStorage);

import { useAppStore, getPersistedRepo } from "@/stores/app-store";

describe("app-store", () => {
  beforeEach(() => {
    localStore.clear();
    useAppStore.setState({
      filters: { status: "ready" },
      commandPaletteOpen: false,
      viewMode: "table",
      activeRepo: null,
      registeredRepos: [],
      pageSize: 50,
    });
  });

  it("has correct initial state", () => {
    const state = useAppStore.getState();
    expect(state.filters).toEqual({ status: "ready" });
    expect(state.commandPaletteOpen).toBe(false);
    expect(state.viewMode).toBe("table");
    expect(state.activeRepo).toBeNull();
    expect(state.registeredRepos).toEqual([]);
    expect(state.pageSize).toBe(50);
  });

  it("sets individual filter", () => {
    useAppStore.getState().setFilter("status", "open");
    expect(useAppStore.getState().filters.status).toBe("open");
  });

  it("sets filter preserves other filters", () => {
    useAppStore.getState().setFilter("type", "bug");
    useAppStore.getState().setFilter("priority", 1);
    const filters = useAppStore.getState().filters;
    expect(filters.status).toBe("ready");
    expect(filters.type).toBe("bug");
    expect(filters.priority).toBe(1);
  });

  it("sets filters from URL", () => {
    const newFilters = { status: "open" as const, type: "feature" as const };
    useAppStore.getState().setFiltersFromUrl(newFilters);
    expect(useAppStore.getState().filters).toEqual(newFilters);
  });

  it("resets filters to initial state", () => {
    useAppStore.getState().setFilter("type", "bug");
    useAppStore.getState().setFilter("assignee", "alice");
    useAppStore.getState().resetFilters();
    expect(useAppStore.getState().filters).toEqual({ status: "ready" });
  });

  it("sets command palette open", () => {
    useAppStore.getState().setCommandPaletteOpen(true);
    expect(useAppStore.getState().commandPaletteOpen).toBe(true);
    useAppStore.getState().setCommandPaletteOpen(false);
    expect(useAppStore.getState().commandPaletteOpen).toBe(false);
  });

  it("toggles command palette", () => {
    expect(useAppStore.getState().commandPaletteOpen).toBe(false);
    useAppStore.getState().toggleCommandPalette();
    expect(useAppStore.getState().commandPaletteOpen).toBe(true);
    useAppStore.getState().toggleCommandPalette();
    expect(useAppStore.getState().commandPaletteOpen).toBe(false);
  });

  it("sets view mode", () => {
    useAppStore.getState().setViewMode("board");
    expect(useAppStore.getState().viewMode).toBe("board");
    useAppStore.getState().setViewMode("table");
    expect(useAppStore.getState().viewMode).toBe("table");
  });

  it("sets active repo and persists to localStorage", () => {
    useAppStore.getState().setActiveRepo("/tmp/my-repo");
    expect(useAppStore.getState().activeRepo).toBe("/tmp/my-repo");
    expect(localStore.get("foolery:lastRepo")).toBe("/tmp/my-repo");
  });

  it("clears active repo and removes from localStorage", () => {
    useAppStore.getState().setActiveRepo("/tmp/my-repo");
    useAppStore.getState().setActiveRepo(null);
    expect(useAppStore.getState().activeRepo).toBeNull();
    expect(localStore.has("foolery:lastRepo")).toBe(false);
  });

  it("sets registered repos", () => {
    const repos = [
      { path: "/tmp/repo-a", name: "repo-a" },
      { path: "/tmp/repo-b", name: "repo-b" },
    ];
    useAppStore.getState().setRegisteredRepos(repos as never);
    expect(useAppStore.getState().registeredRepos).toEqual(repos);
  });

  it("sets page size", () => {
    useAppStore.getState().setPageSize(100);
    expect(useAppStore.getState().pageSize).toBe(100);
  });

  it("getPersistedRepo returns value from localStorage", () => {
    localStore.set("foolery:lastRepo", "/tmp/saved-repo");
    expect(getPersistedRepo()).toBe("/tmp/saved-repo");
  });

  it("getPersistedRepo returns null when nothing saved", () => {
    expect(getPersistedRepo()).toBeNull();
  });
});
