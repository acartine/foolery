import { beforeEach, describe, expect, it } from "vitest";
import { useTerminalStore } from "@/stores/terminal-store";

describe("terminal store updateStatus", () => {
  beforeEach(() => {
    useTerminalStore.setState({
      panelOpen: false,
      panelHeight: 35,
      terminals: [],
      activeSessionId: null,
    });
  });

  it("does not mutate state when status is unchanged", () => {
    const state = useTerminalStore.getState();
    state.upsertTerminal({
      sessionId: "session-1",
      beadId: "foolery-1",
      beadTitle: "Test bead",
      status: "completed",
      startedAt: "2026-02-13T00:00:00.000Z",
    });

    const before = useTerminalStore.getState().terminals;
    const beforeTerminal = before[0];

    useTerminalStore.getState().updateStatus("session-1", "completed");

    const after = useTerminalStore.getState().terminals;
    expect(after).toBe(before);
    expect(after[0]).toBe(beforeTerminal);
  });

  it("updates the terminal status when it changes", () => {
    const state = useTerminalStore.getState();
    state.upsertTerminal({
      sessionId: "session-2",
      beadId: "foolery-2",
      beadTitle: "Another bead",
      status: "running",
      startedAt: "2026-02-13T00:00:00.000Z",
    });

    const before = useTerminalStore.getState().terminals;
    useTerminalStore.getState().updateStatus("session-2", "completed");
    const after = useTerminalStore.getState().terminals;

    expect(after).not.toBe(before);
    expect(after[0]?.status).toBe("completed");
  });
});
