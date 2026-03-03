import { beforeEach, describe, expect, it } from "vitest";
import { useTerminalStore } from "@/stores/terminal-store";

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
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  } as Storage;
}

describe("terminal store updateStatus", () => {
  beforeEach(() => {
    localStorage.removeItem("foolery:terminal-store");
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
      beatId: "foolery-1",
      beatTitle: "Test beat",
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
      beatId: "foolery-2",
      beatTitle: "Another beat",
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
