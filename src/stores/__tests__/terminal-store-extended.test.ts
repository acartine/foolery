import { beforeEach, describe, expect, it } from "vitest";
import { useTerminalStore, getActiveTerminal } from "@/stores/terminal-store";
import type { ActiveTerminal } from "@/stores/terminal-store";
import type { TerminalSession } from "@/lib/types";

// Provide a minimal localStorage polyfill for the Node test environment
if (
  typeof globalThis.localStorage === "undefined" ||
  typeof globalThis.localStorage.getItem !== "function" ||
  typeof globalThis.localStorage.setItem !== "function" ||
  typeof globalThis.localStorage.removeItem !== "function"
) {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
  } as Storage;
}

function makeTerminal(overrides: Partial<ActiveTerminal> = {}): ActiveTerminal {
  return {
    sessionId: "s-1",
    beatId: "b-1",
    beatTitle: "Test",
    status: "running",
    startedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function resetTerminalStore(): void {
  localStorage.removeItem("foolery:terminal-store");
  useTerminalStore.setState({
    panelOpen: false,
    panelHeight: 35,
    terminals: [],
    activeSessionId: null,
    pendingClose: new Set(),
  });
}

describe("terminal-store panel controls", () => {
  beforeEach(resetTerminalStore);

  it("opens the panel", () => {
    useTerminalStore.getState().openPanel();
    expect(useTerminalStore.getState().panelOpen).toBe(true);
  });

  it("closes the panel", () => {
    useTerminalStore.setState({ panelOpen: true });
    useTerminalStore.getState().closePanel();
    expect(useTerminalStore.getState().panelOpen).toBe(false);
  });

  it("toggles panel from closed to open", () => {
    useTerminalStore.getState().togglePanel();
    expect(useTerminalStore.getState().panelOpen).toBe(true);
  });

  it("toggles panel from open to closed", () => {
    useTerminalStore.setState({ panelOpen: true });
    useTerminalStore.getState().togglePanel();
    expect(useTerminalStore.getState().panelOpen).toBe(false);
  });

  it("clamps height to minimum 15", () => {
    useTerminalStore.getState().setPanelHeight(5);
    expect(useTerminalStore.getState().panelHeight).toBe(15);
  });

  it("clamps height to maximum 80", () => {
    useTerminalStore.getState().setPanelHeight(100);
    expect(useTerminalStore.getState().panelHeight).toBe(80);
  });

  it("accepts height within range", () => {
    useTerminalStore.getState().setPanelHeight(50);
    expect(useTerminalStore.getState().panelHeight).toBe(50);
  });
});

describe("terminal-store terminal lifecycle", () => {
  beforeEach(resetTerminalStore);

  it("clears all terminals and resets state", () => {
    useTerminalStore.setState({
      terminals: [makeTerminal()],
      activeSessionId: "s-1",
      pendingClose: new Set(["s-1"]),
    });
    useTerminalStore.getState().clearTerminals();
    const state = useTerminalStore.getState();
    expect(state.terminals).toEqual([]);
    expect(state.activeSessionId).toBeNull();
    expect(state.pendingClose.size).toBe(0);
  });

  it("adds a new terminal and sets it active", () => {
    const terminal = makeTerminal();
    useTerminalStore.getState().upsertTerminal(terminal);
    const state = useTerminalStore.getState();
    expect(state.terminals).toHaveLength(1);
    expect(state.activeSessionId).toBe("s-1");
    expect(state.panelOpen).toBe(true);
  });

  it("updates an existing terminal by sessionId", () => {
    useTerminalStore.getState().upsertTerminal(makeTerminal());
    useTerminalStore
      .getState()
      .upsertTerminal(makeTerminal({ status: "completed" }));
    const state = useTerminalStore.getState();
    expect(state.terminals).toHaveLength(1);
    expect(state.terminals[0].status).toBe("completed");
  });

  it("adds a second terminal alongside first", () => {
    useTerminalStore.getState().upsertTerminal(makeTerminal());
    useTerminalStore
      .getState()
      .upsertTerminal(makeTerminal({ sessionId: "s-2" }));
    expect(useTerminalStore.getState().terminals).toHaveLength(2);
    expect(useTerminalStore.getState().activeSessionId).toBe("s-2");
  });

  it("removes a terminal by sessionId", () => {
    useTerminalStore.getState().upsertTerminal(makeTerminal());
    useTerminalStore.getState().removeTerminal("s-1");
    expect(useTerminalStore.getState().terminals).toHaveLength(0);
  });

  it("selects last terminal when removing active", () => {
    useTerminalStore.getState().upsertTerminal(makeTerminal({ sessionId: "s-1" }));
    useTerminalStore.getState().upsertTerminal(makeTerminal({ sessionId: "s-2" }));
    useTerminalStore.getState().removeTerminal("s-2");
    expect(useTerminalStore.getState().activeSessionId).toBe("s-1");
  });

  it("sets activeSessionId to null when last terminal removed", () => {
    useTerminalStore.getState().upsertTerminal(makeTerminal());
    useTerminalStore.getState().removeTerminal("s-1");
    expect(useTerminalStore.getState().activeSessionId).toBeNull();
  });

  it("closes panel when last terminal is removed", () => {
    useTerminalStore.getState().upsertTerminal(makeTerminal());
    expect(useTerminalStore.getState().panelOpen).toBe(true);
    useTerminalStore.getState().removeTerminal("s-1");
    expect(useTerminalStore.getState().panelOpen).toBe(false);
  });

  it("keeps panel open when other terminals remain", () => {
    useTerminalStore.getState().upsertTerminal(makeTerminal({ sessionId: "s-1" }));
    useTerminalStore.getState().upsertTerminal(makeTerminal({ sessionId: "s-2" }));
    useTerminalStore.getState().removeTerminal("s-1");
    expect(useTerminalStore.getState().panelOpen).toBe(true);
  });

  it("removes sessionId from pendingClose", () => {
    useTerminalStore.getState().upsertTerminal(makeTerminal());
    useTerminalStore.getState().markPendingClose("s-1");
    useTerminalStore.getState().removeTerminal("s-1");
    expect(useTerminalStore.getState().pendingClose.has("s-1")).toBe(false);
  });

  it("does not change active when removing non-active terminal", () => {
    useTerminalStore.getState().upsertTerminal(makeTerminal({ sessionId: "s-1" }));
    useTerminalStore.getState().upsertTerminal(makeTerminal({ sessionId: "s-2" }));
    useTerminalStore.getState().removeTerminal("s-1");
    expect(useTerminalStore.getState().activeSessionId).toBe("s-2");
  });
});

describe("terminal-store session selection", () => {
  beforeEach(resetTerminalStore);

  it("sets active session when it exists", () => {
    useTerminalStore.getState().upsertTerminal(makeTerminal({ sessionId: "s-1" }));
    useTerminalStore.getState().upsertTerminal(makeTerminal({ sessionId: "s-2" }));
    useTerminalStore.getState().setActiveSession("s-1");
    expect(useTerminalStore.getState().activeSessionId).toBe("s-1");
    expect(useTerminalStore.getState().panelOpen).toBe(true);
  });

  it("does nothing when session does not exist", () => {
    useTerminalStore.getState().upsertTerminal(makeTerminal());
    useTerminalStore.getState().setActiveSession("nonexistent");
    expect(useTerminalStore.getState().activeSessionId).toBe("s-1");
  });

  it("clears pending close for the activated session", () => {
    useTerminalStore.getState().upsertTerminal(makeTerminal());
    useTerminalStore.getState().markPendingClose("s-1");
    useTerminalStore.getState().setActiveSession("s-1");
    expect(useTerminalStore.getState().pendingClose.has("s-1")).toBe(false);
  });

  it("marks a session as pending close", () => {
    useTerminalStore.getState().markPendingClose("s-1");
    expect(useTerminalStore.getState().pendingClose.has("s-1")).toBe(true);
  });

  it("cancels pending close", () => {
    useTerminalStore.getState().markPendingClose("s-1");
    useTerminalStore.getState().cancelPendingClose("s-1");
    expect(useTerminalStore.getState().pendingClose.has("s-1")).toBe(false);
  });

  it("cancelPendingClose returns same state if not pending", () => {
    const before = useTerminalStore.getState();
    useTerminalStore.getState().cancelPendingClose("unknown");
    const after = useTerminalStore.getState();
    expect(before.pendingClose).toBe(after.pendingClose);
  });
});

describe("terminal-store status updates", () => {
  beforeEach(resetTerminalStore);

  it("does not change terminals ref when status unchanged", () => {
    useTerminalStore
      .getState()
      .upsertTerminal(makeTerminal({ status: "completed" }));
    const before = useTerminalStore.getState().terminals;
    useTerminalStore.getState().updateStatus("s-1", "completed");
    const after = useTerminalStore.getState().terminals;
    expect(after).toBe(before);
  });

  it("no-ops for non-existent session", () => {
    useTerminalStore.getState().upsertTerminal(makeTerminal());
    const before = useTerminalStore.getState();
    useTerminalStore.getState().updateStatus("unknown", "error");
    const after = useTerminalStore.getState();
    expect(before.terminals).toBe(after.terminals);
  });
});

describe("getActiveTerminal", () => {
  it("returns null when activeSessionId is null", () => {
    expect(getActiveTerminal([makeTerminal()], null)).toBeNull();
  });

  it("returns the matching terminal", () => {
    const terminal = makeTerminal();
    expect(getActiveTerminal([terminal], "s-1")).toBe(terminal);
  });

  it("returns null when no match found", () => {
    expect(getActiveTerminal([makeTerminal()], "nonexistent")).toBeNull();
  });
});

function makeBackendSession(
  overrides: Partial<TerminalSession> = {},
): TerminalSession {
  return {
    id: "s-1",
    beatId: "b-1",
    beatTitle: "Test",
    status: "running",
    startedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("persist configuration", () => {
  beforeEach(resetTerminalStore);

  it("store has rehydrateFromBackend action", () => {
    expect(typeof useTerminalStore.getState().rehydrateFromBackend).toBe("function");
  });

  it("non-serializable state (pendingClose, sceneQueue) resets on fresh store", () => {
    const state = useTerminalStore.getState();
    expect(state.pendingClose).toBeInstanceOf(Set);
    expect(state.sceneQueue).toEqual([]);
  });
});

describe("rehydrateFromBackend", () => {
  beforeEach(resetTerminalStore);

  it("marks stale running terminals as disconnected when absent from backend", () => {
    useTerminalStore.getState().upsertTerminal(makeTerminal({ status: "running" }));
    useTerminalStore.getState().rehydrateFromBackend([]);
    expect(useTerminalStore.getState().terminals[0].status).toBe("disconnected");
  });

  it("does not change non-running terminals absent from backend", () => {
    useTerminalStore.getState().upsertTerminal(makeTerminal({ status: "error" }));
    useTerminalStore.getState().rehydrateFromBackend([]);
    expect(useTerminalStore.getState().terminals[0].status).toBe("error");
  });

  it("syncs status from backend for known terminals", () => {
    useTerminalStore.getState().upsertTerminal(makeTerminal({ status: "running" }));
    useTerminalStore.getState().rehydrateFromBackend([
      makeBackendSession({ id: "s-1", status: "completed" }),
    ]);
    expect(useTerminalStore.getState().terminals[0].status).toBe("completed");
  });

  it("syncs startedAt from backend for known terminals", () => {
    useTerminalStore.getState().upsertTerminal(
      makeTerminal({ startedAt: "2026-01-01T00:00:00Z" }),
    );
    useTerminalStore.getState().rehydrateFromBackend([
      makeBackendSession({ id: "s-1", startedAt: "2026-01-01T01:00:00Z" }),
    ]);
    expect(useTerminalStore.getState().terminals[0].startedAt).toBe(
      "2026-01-01T01:00:00Z",
    );
  });

  it("adopts orphaned running backend sessions", () => {
    useTerminalStore.getState().rehydrateFromBackend([
      makeBackendSession({
        id: "orphan-1",
        beatId: "b-orphan",
        status: "running",
      }),
    ]);
    const state = useTerminalStore.getState();
    expect(state.terminals).toHaveLength(1);
    expect(state.terminals[0].sessionId).toBe("orphan-1");
  });

  it("does not adopt completed orphan sessions", () => {
    useTerminalStore.getState().rehydrateFromBackend([
      makeBackendSession({ id: "orphan-1", status: "completed" }),
    ]);
    expect(useTerminalStore.getState().terminals).toHaveLength(0);
  });

  it("fixes activeSessionId when it points to a non-existent terminal", () => {
    useTerminalStore.setState({
      terminals: [],
      activeSessionId: "gone",
    });
    useTerminalStore.getState().rehydrateFromBackend([
      makeBackendSession({ id: "alive", status: "running" }),
    ]);
    const state = useTerminalStore.getState();
    expect(state.activeSessionId).toBe("alive");
  });
});
