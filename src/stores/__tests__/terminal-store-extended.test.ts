import { beforeEach, describe, expect, it } from "vitest";
import { useTerminalStore, getActiveTerminal } from "@/stores/terminal-store";
import type { ActiveTerminal } from "@/stores/terminal-store";

function makeTerminal(overrides: Partial<ActiveTerminal> = {}): ActiveTerminal {
  return {
    sessionId: "s-1",
    beadId: "b-1",
    beadTitle: "Test",
    status: "running",
    startedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("terminal-store extended", () => {
  beforeEach(() => {
    useTerminalStore.setState({
      panelOpen: false,
      panelHeight: 35,
      terminals: [],
      activeSessionId: null,
      pendingClose: new Set(),
    });
  });

  describe("openPanel / closePanel", () => {
    it("opens the panel", () => {
      useTerminalStore.getState().openPanel();
      expect(useTerminalStore.getState().panelOpen).toBe(true);
    });

    it("closes the panel", () => {
      useTerminalStore.setState({ panelOpen: true });
      useTerminalStore.getState().closePanel();
      expect(useTerminalStore.getState().panelOpen).toBe(false);
    });
  });

  describe("togglePanel", () => {
    it("toggles panel from closed to open", () => {
      useTerminalStore.getState().togglePanel();
      expect(useTerminalStore.getState().panelOpen).toBe(true);
    });

    it("toggles panel from open to closed", () => {
      useTerminalStore.setState({ panelOpen: true });
      useTerminalStore.getState().togglePanel();
      expect(useTerminalStore.getState().panelOpen).toBe(false);
    });
  });

  describe("setPanelHeight", () => {
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

  describe("clearTerminals", () => {
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
  });

  describe("upsertTerminal", () => {
    it("adds a new terminal and sets it active", () => {
      const t = makeTerminal();
      useTerminalStore.getState().upsertTerminal(t);
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
  });

  describe("removeTerminal", () => {
    it("removes a terminal by sessionId", () => {
      useTerminalStore.getState().upsertTerminal(makeTerminal());
      useTerminalStore.getState().removeTerminal("s-1");
      expect(useTerminalStore.getState().terminals).toHaveLength(0);
    });

    it("selects last terminal when removing active", () => {
      useTerminalStore
        .getState()
        .upsertTerminal(makeTerminal({ sessionId: "s-1" }));
      useTerminalStore
        .getState()
        .upsertTerminal(makeTerminal({ sessionId: "s-2" }));
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
      useTerminalStore
        .getState()
        .upsertTerminal(makeTerminal({ sessionId: "s-1" }));
      useTerminalStore
        .getState()
        .upsertTerminal(makeTerminal({ sessionId: "s-2" }));
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
      useTerminalStore
        .getState()
        .upsertTerminal(makeTerminal({ sessionId: "s-1" }));
      useTerminalStore
        .getState()
        .upsertTerminal(makeTerminal({ sessionId: "s-2" }));
      // s-2 is active
      useTerminalStore.getState().removeTerminal("s-1");
      expect(useTerminalStore.getState().activeSessionId).toBe("s-2");
    });
  });

  describe("setActiveSession", () => {
    it("sets active session when it exists", () => {
      useTerminalStore
        .getState()
        .upsertTerminal(makeTerminal({ sessionId: "s-1" }));
      useTerminalStore
        .getState()
        .upsertTerminal(makeTerminal({ sessionId: "s-2" }));
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
  });

  describe("markPendingClose / cancelPendingClose", () => {
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

  describe("updateStatus", () => {
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
});

describe("getActiveTerminal", () => {
  it("returns null when activeSessionId is null", () => {
    expect(getActiveTerminal([makeTerminal()], null)).toBeNull();
  });

  it("returns the matching terminal", () => {
    const t = makeTerminal();
    expect(getActiveTerminal([t], "s-1")).toBe(t);
  });

  it("returns null when no match found", () => {
    expect(getActiveTerminal([makeTerminal()], "nonexistent")).toBeNull();
  });
});
