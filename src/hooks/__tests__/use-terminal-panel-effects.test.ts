import { beforeEach, describe, expect, it, vi } from "vitest";

const listSessionsMock = vi.fn();
const rehydrateFromBackendMock = vi.fn();

vi.mock("react", () => ({
  useEffect: (callback: () => void | (() => void)) => {
    callback();
  },
  useRef: () => ({ current: false }),
}));

vi.mock("@/lib/terminal-api", () => ({
  listSessions: listSessionsMock,
}));

vi.mock("@/stores/terminal-store", () => ({
  useTerminalStore: {
    getState: () => ({
      terminals: [],
      rehydrateFromBackend: rehydrateFromBackendMock,
    }),
  },
}));

describe("useRehydrateTerminals", () => {
  beforeEach(() => {
    listSessionsMock.mockReset();
    rehydrateFromBackendMock.mockReset();
  });

  it("fetches backend sessions even when the local store is empty", async () => {
    const sessions = [{
      id: "sess-1",
      beatId: "beat-1",
      beatTitle: "Fixture Beat",
      status: "running",
      startedAt: "2026-03-31T12:00:00.000Z",
    }];
    const setEnabled = vi.fn();
    listSessionsMock.mockResolvedValue(sessions);

    const { useRehydrateTerminals } = await import(
      "../use-terminal-panel-effects"
    );

    useRehydrateTerminals(setEnabled);
    await Promise.resolve();
    await Promise.resolve();

    expect(listSessionsMock).toHaveBeenCalledTimes(1);
    expect(rehydrateFromBackendMock).toHaveBeenCalledWith(sessions);
    expect(setEnabled).toHaveBeenCalledWith(true);
  });
});
