import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock connectToSession before importing the manager
// ---------------------------------------------------------------------------
type EventCallback = (event: { type: string; data: string; timestamp: number }) => void;
type ErrorCallback = (error: Event) => void;

let capturedOnEvent: EventCallback | null = null;
let capturedOnError: ErrorCallback | null = null;
let closeCallCount = 0;

vi.mock("../terminal-api", () => ({
  connectToSession: vi.fn(
    (
      _sessionId: string,
      onEvent: EventCallback,
      onError?: ErrorCallback,
    ) => {
      capturedOnEvent = onEvent;
      capturedOnError = onError ?? null;
      return () => {
        closeCallCount++;
      };
    },
  ),
}));

// Mock the terminal store
const mockUpdateStatus = vi.fn();
const mockTerminals: Array<{
  sessionId: string;
  status: string;
  beatId: string;
  beatTitle: string;
  repoPath?: string;
}> = [];
let storeSubscribers: Array<() => void> = [];

vi.mock("@/stores/terminal-store", () => ({
  useTerminalStore: Object.assign(
    () => ({}),
    {
      getState: () => ({
        terminals: mockTerminals,
        updateStatus: mockUpdateStatus,
      }),
      subscribe: (fn: () => void) => {
        storeSubscribers.push(fn);
        return () => {
          storeSubscribers = storeSubscribers.filter((s) => s !== fn);
        };
      },
    },
  ),
}));

// Mock notification store
const mockAddNotification = vi.fn();
vi.mock("@/stores/notification-store", () => ({
  useNotificationStore: Object.assign(
    () => ({}),
    {
      getState: () => ({
        addNotification: mockAddNotification,
      }),
    },
  ),
}));

const approvalMocks = vi.hoisted(() => ({
  mockUpsertPendingApproval: vi.fn(() => true),
  mockToastWarning: vi.fn(),
}));

vi.mock("@/stores/approval-escalation-store", () => ({
  useApprovalEscalationStore: {
    getState: () => ({
      upsertPendingApproval: approvalMocks.mockUpsertPendingApproval,
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    warning: approvalMocks.mockToastWarning,
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------
import { connectToSession } from "../terminal-api";
import { sessionConnections } from "../session-connection-manager";

beforeEach(() => {
  capturedOnEvent = null;
  capturedOnError = null;
  closeCallCount = 0;
  mockTerminals.length = 0;
  storeSubscribers = [];
  mockUpdateStatus.mockClear();
  mockAddNotification.mockClear();
  approvalMocks.mockUpsertPendingApproval.mockClear();
  approvalMocks.mockUpsertPendingApproval.mockReturnValue(true);
  approvalMocks.mockToastWarning.mockClear();
  // Disconnect any leftover connections
  for (const id of sessionConnections.getConnectedIds()) {
    sessionConnections.disconnect(id);
  }
  sessionConnections.stopSync();
});

afterEach(() => {
  sessionConnections.stopSync();
});

function expectSharedBeatQueryInvalidation(
  invalidateQueries: ReturnType<typeof vi.fn>,
): void {
  expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
    queryKey: ["beats"],
    refetchType: "active",
  });
  expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
    queryKey: ["setlist-plan"],
    refetchType: "active",
  });
  expect(invalidateQueries).toHaveBeenNthCalledWith(3, {
    queryKey: ["setlist-plan-beat"],
    refetchType: "active",
  });
}

function createMockQueryClient(): import("@tanstack/react-query").QueryClient {
  return {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("@tanstack/react-query").QueryClient;
}

describe("SessionConnectionManager: connection lifecycle state handling", () => {
  it("connect() is idempotent", () => {
    const mockConnect = vi.mocked(connectToSession);
    sessionConnections.connect("sess-1");
    sessionConnections.connect("sess-1");

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(sessionConnections.getConnectedIds()).toEqual(["sess-1"]);
  });

  it("exit event updates terminal store status to completed", () => {
    sessionConnections.connect("sess-2");
    expect(capturedOnEvent).not.toBeNull();

    capturedOnEvent!({ type: "exit", data: "0", timestamp: Date.now() });

    expect(mockUpdateStatus).toHaveBeenCalledWith("sess-2", "completed");
  });

  it("exit event with non-zero code updates status to error", () => {
    sessionConnections.connect("sess-3");

    capturedOnEvent!({ type: "exit", data: "1", timestamp: Date.now() });

    expect(mockUpdateStatus).toHaveBeenCalledWith("sess-3", "error");
  });

  it("exit event invalidates beat queries for background completions", () => {
    const mockQueryClient = createMockQueryClient();
    sessionConnections.startSync(mockQueryClient);

    sessionConnections.connect("sess-4");
    capturedOnEvent!({ type: "exit", data: "0", timestamp: Date.now() });

    expectSharedBeatQueryInvalidation(
      vi.mocked(mockQueryClient.invalidateQueries),
    );
  });

  it("beat_state_observed invalidates setlist-sensitive queries immediately", () => {
    const mockQueryClient = createMockQueryClient();
    sessionConnections.startSync(mockQueryClient);

    sessionConnections.connect("sess-4b");
    capturedOnEvent!({
      type: "beat_state_observed",
      data: JSON.stringify({
        beatId: "beat-4b",
        state: "shipped",
        reason: "post_exit_state_observed",
      }),
      timestamp: Date.now(),
    });

    expectSharedBeatQueryInvalidation(
      vi.mocked(mockQueryClient.invalidateQueries),
    );
    expect(mockUpdateStatus).not.toHaveBeenCalled();
    expect(mockAddNotification).not.toHaveBeenCalled();
  });
});

describe("SessionConnectionManager: connection lifecycle buffering", () => {
  it("subscribe() receives forwarded events", () => {
    sessionConnections.connect("sess-5");
    const listener = vi.fn();
    sessionConnections.subscribe("sess-5", listener);

    const event = { type: "stdout" as const, data: "hello", timestamp: Date.now() };
    capturedOnEvent!(event);

    expect(listener).toHaveBeenCalledWith(event);
  });

  it("unsubscribe stops forwarding events", () => {
    sessionConnections.connect("sess-6");
    const listener = vi.fn();
    const unsub = sessionConnections.subscribe("sess-6", listener);
    unsub();

    capturedOnEvent!({ type: "stdout", data: "hello", timestamp: Date.now() });

    expect(listener).not.toHaveBeenCalled();
  });

  it("getBuffer() returns buffered events for replay", () => {
    sessionConnections.connect("sess-7");

    capturedOnEvent!({ type: "stdout", data: "line1", timestamp: 1 });
    capturedOnEvent!({ type: "stderr", data: "err", timestamp: 2 });
    capturedOnEvent!({ type: "exit", data: "0", timestamp: 3 });

    const buffer = sessionConnections.getBuffer("sess-7");
    expect(buffer).toEqual([
      { type: "stdout", data: "line1" },
      { type: "stderr", data: "err" },
      { type: "exit", data: "0" },
    ]);
  });

  it("getBuffer() returns empty array for unknown session", () => {
    expect(sessionConnections.getBuffer("unknown")).toEqual([]);
  });

  it("disconnect() closes EventSource", () => {
    sessionConnections.connect("sess-8");
    const before = closeCallCount;
    sessionConnections.disconnect("sess-8");

    expect(closeCallCount).toBe(before + 1);
    expect(sessionConnections.getConnectedIds()).toEqual([]);
  });

  it("hasExited() returns correct state", () => {
    sessionConnections.connect("sess-9");

    expect(sessionConnections.hasExited("sess-9")).toBe(false);

    capturedOnEvent!({ type: "exit", data: "0", timestamp: Date.now() });

    expect(sessionConnections.hasExited("sess-9")).toBe(true);
  });

  it("getExitCode() returns null before exit, code after", () => {
    sessionConnections.connect("sess-10");
    expect(sessionConnections.getExitCode("sess-10")).toBeNull();

    capturedOnEvent!({ type: "exit", data: "42", timestamp: Date.now() });
    expect(sessionConnections.getExitCode("sess-10")).toBe(42);
  });

  it("onError removes connection entry (allows re-sync to reconnect)", () => {
    sessionConnections.connect("sess-11");
    expect(sessionConnections.getConnectedIds()).toContain("sess-11");

    capturedOnError!({} as Event);

    expect(sessionConnections.getConnectedIds()).not.toContain("sess-11");
  });
});

describe("SessionConnectionManager: sync and notification", () => {
    it("startSync connects SSE for running terminals", () => {
    const mockConnect = vi.mocked(connectToSession);
    mockConnect.mockClear();

    mockTerminals.push({ sessionId: "sess-s1", status: "running", beatId: "beat-1", beatTitle: "Test Beat" });
    mockTerminals.push({ sessionId: "sess-s2", status: "completed", beatId: "beat-2", beatTitle: "Done Beat" });

    sessionConnections.startSync({ invalidateQueries: vi.fn() } as unknown as import("@tanstack/react-query").QueryClient);

    // Should only connect to running session
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(sessionConnections.getConnectedIds()).toContain("sess-s1");
    expect(sessionConnections.getConnectedIds()).not.toContain("sess-s2");
  });

  it("startSync is idempotent (no double subscribe)", () => {
    const mockQC = { invalidateQueries: vi.fn() } as unknown as import("@tanstack/react-query").QueryClient;
    sessionConnections.startSync(mockQC);
    const subCount = storeSubscribers.length;
    sessionConnections.startSync(mockQC);

    expect(storeSubscribers.length).toBe(subCount);
  });

  it("stopSync disconnects all and unsubscribes", () => {
    mockTerminals.push({ sessionId: "sess-stop", status: "running", beatId: "beat-stop", beatTitle: "Stop Beat" });
    sessionConnections.startSync({ invalidateQueries: vi.fn() } as unknown as import("@tanstack/react-query").QueryClient);

    expect(sessionConnections.getConnectedIds().length).toBeGreaterThan(0);

    sessionConnections.stopSync();

    expect(sessionConnections.getConnectedIds()).toEqual([]);
    expect(storeSubscribers.length).toBe(0);
  });

  it("exit event fires in-app notification with beat info", () => {
    mockTerminals.push({
      sessionId: "sess-notif",
      status: "running",
      beatId: "beat-42",
      beatTitle: "Fix login bug",
      repoPath: "/repos/foolery",
    });
    sessionConnections.connect("sess-notif");

    capturedOnEvent!({ type: "exit", data: "0", timestamp: Date.now() });

    expect(mockAddNotification).toHaveBeenCalledWith({
      message: '"Fix login bug" session completed',
      beatId: "beat-42",
      repoPath: "/repos/foolery",
    });
  });

  it("exit event with non-zero code fires error notification", () => {
    mockTerminals.push({
      sessionId: "sess-notif-err",
      status: "running",
      beatId: "beat-43",
      beatTitle: "Deploy service",
      repoPath: "/repos/deploy",
    });
    sessionConnections.connect("sess-notif-err");

    capturedOnEvent!({ type: "exit", data: "1", timestamp: Date.now() });

    expect(mockAddNotification).toHaveBeenCalledWith({
      message: '"Deploy service" session exited with error (exit code 1, no error output captured)',
      beatId: "beat-43",
      repoPath: "/repos/deploy",
    });
  });

  it("duplicate exit events only notify once", () => {
    mockTerminals.push({ sessionId: "sess-notif-once", status: "running", beatId: "beat-44", beatTitle: "One-shot exit" });
    sessionConnections.connect("sess-notif-once");

    capturedOnEvent!({ type: "exit", data: "0", timestamp: Date.now() });
    capturedOnEvent!({ type: "exit", data: "0", timestamp: Date.now() });

    expect(mockAddNotification).toHaveBeenCalledTimes(1);
  });

  it("preserves aborted status when exit event arrives", () => {
    mockTerminals.push({
      sessionId: "sess-aborted",
      status: "aborted",
      beatId: "beat-50",
      beatTitle: "Aborted session",
      repoPath: "/repos/test",
    });
    sessionConnections.connect("sess-aborted");

    // Exit event arrives after session was already marked aborted
    capturedOnEvent!({ type: "exit", data: "0", timestamp: Date.now() });

    // updateStatus should NOT have been called — status stays "aborted"
    expect(mockUpdateStatus).not.toHaveBeenCalled();

    // Notification should say "terminated" instead of "completed"
    expect(mockAddNotification).toHaveBeenCalledWith({
      message: '"Aborted session" session terminated',
      beatId: "beat-50",
      repoPath: "/repos/test",
    });
  });

  it("does not preserve aborted if exit arrives for running session", () => {
    mockTerminals.push({
      sessionId: "sess-running-exit",
      status: "running",
      beatId: "beat-51",
      beatTitle: "Running session",
    });
    sessionConnections.connect("sess-running-exit");

    capturedOnEvent!({ type: "exit", data: "0", timestamp: Date.now() });

    // Should update status normally
    expect(mockUpdateStatus).toHaveBeenCalledWith("sess-running-exit", "completed");
  });

});

describe("SessionConnectionManager: approval notifications", () => {
  it("approval banner events feed approvals, toast, and inbox once", () => {
    mockTerminals.push({
      sessionId: "sess-approval",
      status: "running",
      beatId: "beat-approval",
      beatTitle: "Approval fixture",
      repoPath: "/repos/foolery",
    });
    sessionConnections.connect("sess-approval");

    capturedOnEvent!({
      type: "stderr",
      data: [
        "FOOLERY APPROVAL REQUIRED",
        "adapter=codex",
        "source=mcpServer/elicitation/request",
        "serverName=playwright",
        "toolName=browser_evaluate",
        "message=Allow browser_evaluate?",
      ].join("\n"),
      timestamp: Date.now(),
    });

    expect(approvalMocks.mockUpsertPendingApproval).toHaveBeenCalledTimes(1);
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "approval",
        message: "Approval required: playwright / browser_evaluate",
        beatId: "beat-approval",
        repoPath: "/repos/foolery",
        href: "/beats?view=finalcut&tab=approvals&repo=%2Frepos%2Ffoolery",
      }),
    );
    expect(approvalMocks.mockToastWarning).toHaveBeenCalledTimes(1);
  });

  it("duplicate approval events do not emit a second notification", () => {
    approvalMocks.mockUpsertPendingApproval.mockReturnValue(false);
    mockTerminals.push({
      sessionId: "sess-approval-dupe",
      status: "running",
      beatId: "beat-approval",
      beatTitle: "Approval fixture",
    });
    sessionConnections.connect("sess-approval-dupe");

    capturedOnEvent!({
      type: "stdout",
      data: [
        "FOOLERY APPROVAL REQUIRED",
        "adapter=codex",
        "source=mcpServer/elicitation/request",
      ].join("\n"),
      timestamp: Date.now(),
    });

    expect(approvalMocks.mockUpsertPendingApproval).toHaveBeenCalledTimes(1);
    expect(mockAddNotification).not.toHaveBeenCalled();
    expect(approvalMocks.mockToastWarning).not.toHaveBeenCalled();
  });
});
