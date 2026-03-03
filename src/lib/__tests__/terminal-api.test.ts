import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { connectToSession } from "../terminal-api";

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

    // Even after the deferred timer fires, onError should not be called
    vi.advanceTimersByTime(500);
    expect(onError).not.toHaveBeenCalled();
    expect(es.closed).toBe(true);
  });

  it("suppresses onError when stream_end was received", () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    connectToSession("sess-3", onEvent, onError);

    const es = lastES();
    // stream_end is a synthetic marker from the server; it should not
    // be forwarded to the onEvent callback.
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

    // onError should NOT fire synchronously
    expect(onError).not.toHaveBeenCalled();

    // After the 200ms deferral the async handler polls and sees running → onError
    await vi.advanceTimersByTimeAsync(200);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(es.closed).toBe(true);
  });

  it("cancels deferred onError if exit arrives during the deferral window", async () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    connectToSession("sess-5", onEvent, onError);

    const es = lastES();
    // Simulate: error fires, then exit message arrives (race)
    es.simulateError();

    // Before timer fires, deliver the exit event
    vi.advanceTimersByTime(50);
    es.simulateMessage(JSON.stringify({ type: "exit", data: "0" }));

    // Now let the deferred timer fire
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

  // -- Disconnect recovery tests --

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

  it("calls onError when backend session is gone after disconnect", async () => {
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

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "exit" }),
    );
    expect(es.closed).toBe(true);
  });
});
