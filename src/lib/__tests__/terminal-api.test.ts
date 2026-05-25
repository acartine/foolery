import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { connectToSession, connectToSessionEvents } from "../terminal-api";

// ---------------------------------------------------------------------------
// Minimal EventSource mock – simulates the browser API enough for our tests.
// ---------------------------------------------------------------------------
type ESListener = ((ev: MessageEvent) => void) | null;
type ESErrorListener = ((ev: Event) => void) | null;

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  onmessage: ESListener = null;
  onerror: ESErrorListener = null;
  readyState = 0; // CONNECTING
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    // Simulate async open
    queueMicrotask(() => {
      this.readyState = 1; // OPEN
    });
  }

  close() {
    this.closed = true;
    this.readyState = 2; // CLOSED
  }

  // Test helpers ---

  /** Simulate receiving a server-sent message. */
  simulateMessage(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }

  /** Simulate an error / stream close. */
  simulateError() {
    this.onerror?.({} as Event);
  }
}

// Install mock before each test
beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Helpers
const lastES = () => {
  const list = MockEventSource.instances;
  return list[list.length - 1];
};

describe("connectToSession", () => {
  describe("message forwarding and error suppression", () => {
    it("forwards stdout events to onEvent callback", () => {
      const onEvent = vi.fn();
      connectToSession("sess-1", onEvent);

      const es = lastES();
      es.simulateMessage(JSON.stringify({ type: "stdout", data: "hello" }));

      expect(onEvent).toHaveBeenCalledWith({ type: "stdout", data: "hello" });
    });

    it("suppresses onError when exit was already received", () => {
      const onEvent = vi.fn();
      const onError = vi.fn();
      connectToSession("sess-2", onEvent, onError);

      const es = lastES();
      es.simulateMessage(JSON.stringify({ type: "exit", data: "0" }));
      es.simulateError();

      vi.advanceTimersByTime(500);
      expect(onError).not.toHaveBeenCalled();
      expect(es.closed).toBe(true);
    });

    it("suppresses onError when stream_end was received", () => {
      const onEvent = vi.fn();
      const onError = vi.fn();
      connectToSession("sess-3", onEvent, onError);

      const es = lastES();
      es.simulateMessage(JSON.stringify({ type: "stream_end", data: "" }));
      es.simulateError();

      vi.advanceTimersByTime(500);
      expect(onError).not.toHaveBeenCalled();
      expect(onEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "stream_end" }),
      );
      expect(es.closed).toBe(true);
    });

    it("calls onError when backend still shows running after disconnect", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ id: "sess-4", status: "running" }] }),
        }),
      );

      const onEvent = vi.fn();
      const onError = vi.fn();
      connectToSession("sess-4", onEvent, onError);

      const es = lastES();
      es.simulateMessage(JSON.stringify({ type: "stdout", data: "partial" }));
      es.simulateError();

      expect(onError).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(es.closed).toBe(true);
    });

    it("cancels deferred onError if exit arrives during the deferral window", async () => {
      const onEvent = vi.fn();
      const onError = vi.fn();
      connectToSession("sess-5", onEvent, onError);

      const es = lastES();
      es.simulateError();

      vi.advanceTimersByTime(50);
      es.simulateMessage(JSON.stringify({ type: "exit", data: "0" }));

      await vi.advanceTimersByTimeAsync(200);
      expect(onError).not.toHaveBeenCalled();
    });

    it("cleanup function closes the EventSource", () => {
      const cleanup = connectToSession("sess-6", vi.fn());
      const es = lastES();

      expect(es.closed).toBe(false);
      cleanup();
      expect(es.closed).toBe(true);
    });
  });

});

describe("connectToSessionEvents", () => {
  it("opens one multiplex EventSource for sorted unique session ids", () => {
    const cleanup = connectToSessionEvents(["sess-b", "sess-a", "sess-a"], vi.fn());

    expect(MockEventSource.instances).toHaveLength(1);
    expect(lastES().url).toBe("/api/terminal/events?sessionIds=sess-a,sess-b");
    cleanup();
    expect(lastES().closed).toBe(true);
  });

  it("forwards multiplex events with their session id", () => {
    const onEvent = vi.fn();
    connectToSessionEvents(["sess-a"], onEvent);

    lastES().simulateMessage(JSON.stringify({
      sessionId: "sess-a",
      event: { type: "stdout", data: "hello", timestamp: 1 },
    }));

    expect(onEvent).toHaveBeenCalledWith(
      "sess-a",
      { type: "stdout", data: "hello", timestamp: 1 },
    );
  });

  it("suppresses stream_end payloads", () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    connectToSessionEvents(["sess-a"], onEvent, onError);

    const es = lastES();
    es.simulateMessage(JSON.stringify({
      sessionId: "sess-a",
      event: { type: "stream_end", data: "", timestamp: 1 },
    }));
    es.simulateError();

    vi.advanceTimersByTime(500);
    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(es.closed).toBe(true);
  });

  it("recovers exits for ended sessions after disconnect", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ id: "sess-a", status: "completed", exitCode: 0 }],
        }),
      }),
    );
    const onEvent = vi.fn();
    const onError = vi.fn();
    connectToSessionEvents(["sess-a", "sess-missing"], onEvent, onError);

    lastES().simulateError();
    await vi.advanceTimersByTimeAsync(200);

    expect(onEvent).toHaveBeenCalledWith(
      "sess-a",
      expect.objectContaining({ type: "exit", data: "0" }),
    );
    expect(onEvent).toHaveBeenCalledWith(
      "sess-missing",
      expect.objectContaining({ type: "exit", data: "-2" }),
    );
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("connectToSession disconnect recovery", () => {
  describe("disconnect recovery", () => {
    it("synthesizes exit when backend shows completed after disconnect", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            data: [{ id: "sess-r1", status: "completed", exitCode: 0 }],
          }),
        }),
      );

      const onEvent = vi.fn();
      const onError = vi.fn();
      connectToSession("sess-r1", onEvent, onError);

      const es = lastES();
      es.simulateMessage(JSON.stringify({ type: "stdout", data: "output" }));
      es.simulateError();

      await vi.advanceTimersByTimeAsync(200);

      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "exit", data: "0" }),
      );
      expect(onError).not.toHaveBeenCalled();
      expect(es.closed).toBe(true);
    });

    it("synthesizes non-zero exit when backend shows aborted after disconnect", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            data: [{ id: "sess-r2", status: "aborted", exitCode: 1 }],
          }),
        }),
      );

      const onEvent = vi.fn();
      const onError = vi.fn();
      connectToSession("sess-r2", onEvent, onError);

      const es = lastES();
      es.simulateError();

      await vi.advanceTimersByTimeAsync(200);

      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "exit", data: "1" }),
      );
      expect(onError).not.toHaveBeenCalled();
      expect(es.closed).toBe(true);
    });

    it("synthesizes exit 0 when backend session is gone after disconnect", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: [] }),
        }),
      );

      const onEvent = vi.fn();
      const onError = vi.fn();
      connectToSession("sess-r3", onEvent, onError);

      const es = lastES();
      es.simulateError();

      await vi.advanceTimersByTimeAsync(200);

      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "exit", data: "-2" }),
      );
      expect(onError).not.toHaveBeenCalled();
      expect(es.closed).toBe(true);
    });
  });
});
