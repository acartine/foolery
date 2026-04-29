import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listSessionsMock = vi.fn();
const rehydrateFromBackendMock = vi.fn();
const hydrateApprovalEscalationsFromSessionsMock = vi.fn();

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

vi.mock("@/lib/session-approval-hydration", () => ({
  hydrateApprovalEscalationsFromSessions:
    hydrateApprovalEscalationsFromSessionsMock,
}));

describe("useRehydrateTerminals", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listSessionsMock.mockReset();
    rehydrateFromBackendMock.mockReset();
    hydrateApprovalEscalationsFromSessionsMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(
      hydrateApprovalEscalationsFromSessionsMock,
    ).toHaveBeenCalledWith(sessions);
    expect(setEnabled).toHaveBeenCalledWith(true);
  });

  it("keeps polling for sessions created after mount", async () => {
    const initialSessions: never[] = [];
    const nextSessions = [{
      id: "sess-2",
      beatId: "beat-2",
      beatTitle: "Late Session",
      status: "running",
      startedAt: "2026-04-07T12:31:07.724Z",
    }];
    const setEnabled = vi.fn();
    listSessionsMock
      .mockResolvedValueOnce(initialSessions)
      .mockResolvedValueOnce(nextSessions);

    const { useRehydrateTerminals } = await import(
      "../use-terminal-panel-effects"
    );

    useRehydrateTerminals(setEnabled);
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(listSessionsMock).toHaveBeenCalledTimes(2);
    expect(rehydrateFromBackendMock).toHaveBeenNthCalledWith(1, initialSessions);
    expect(rehydrateFromBackendMock).toHaveBeenNthCalledWith(2, nextSessions);
    expect(
      hydrateApprovalEscalationsFromSessionsMock,
    ).toHaveBeenNthCalledWith(1, initialSessions);
    expect(
      hydrateApprovalEscalationsFromSessionsMock,
    ).toHaveBeenNthCalledWith(2, nextSessions);
    expect(setEnabled).toHaveBeenCalledTimes(1);
  });
});
