import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TerminalEvent } from "../types";

type MuxCallback = (sessionId: string, event: TerminalEvent) => void;

let emitMuxEvent: MuxCallback | null = null;
let closeCallCount = 0;

vi.mock("../terminal-api", () => ({
  connectToSessionEvents: vi.fn(
    (_sessionIds: string[], onEvent: MuxCallback) => {
      emitMuxEvent = onEvent;
      return () => {
        closeCallCount++;
      };
    },
  ),
  listSessions: vi.fn().mockResolvedValue([]),
}));

const mockTerminals: Array<{ sessionId: string; status: string }> = [];
const mockUpdateStatus = vi.fn();

vi.mock("@/stores/terminal-store", () => ({
  useTerminalStore: Object.assign(
    () => ({}),
    {
      getState: () => ({
        terminals: mockTerminals,
        updateStatus: mockUpdateStatus,
        rehydrateFromBackend: vi.fn(),
      }),
      subscribe: () => () => {},
    },
  ),
}));

vi.mock("@/stores/notification-store", () => ({
  useNotificationStore: Object.assign(
    () => ({}),
    { getState: () => ({ addNotification: vi.fn() }) },
  ),
}));

vi.mock("@/lib/approval-escalations", () => ({
  approvalEscalationFromBanner: vi.fn(() => null),
}));

vi.mock("@/lib/approval-escalation-client", () => ({
  enqueueApprovalEscalation: vi.fn(),
}));

import { sessionConnections } from "../session-connection-manager";

beforeEach(() => {
  emitMuxEvent = null;
  closeCallCount = 0;
  mockTerminals.length = 0;
  mockUpdateStatus.mockClear();
  sessionConnections.stopSync();
});

afterEach(() => {
  sessionConnections.stopSync();
});

describe("SessionConnectionManager multiplex routing", () => {
  it("routes one shared stream to the matching session listeners", () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    sessionConnections.connect("sess-a");
    sessionConnections.connect("sess-b");
    sessionConnections.subscribe("sess-a", listenerA);
    sessionConnections.subscribe("sess-b", listenerB);

    const event = { type: "stdout", data: "hello", timestamp: 1 } as const;
    emitMuxEvent!("sess-b", event);

    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalledWith(event);
  });

  it("keeps recent output bounded by approximate bytes", () => {
    sessionConnections.connect("sess-bounds");
    const largeDetail = "x".repeat(64_000);

    for (let i = 0; i < 40; i++) {
      emitMuxEvent!("sess-bounds", {
        type: "stdout_detail",
        data: largeDetail,
        timestamp: i,
      });
    }

    const stats = sessionConnections.getConnectionStats()[0];
    expect(stats.bufferBytes).toBeLessThanOrEqual(1_000_000);
    expect(stats.bufferEvents).toBeLessThan(40);
    expect(sessionConnections.getBuffer("sess-bounds").at(-1)?.data).toBe(
      largeDetail,
    );
    expect(closeCallCount).toBe(0);
  });
});
