/**
 * Focused disposal regressions for OpenCode HTTP sessions.
 */
import {
  describe, it, expect, vi, afterEach,
} from "vitest";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import {
  createOpenCodeHttpSession,
} from "@/lib/opencode-http-session";

const BASE_URL = "http://127.0.0.1:9999";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeChild(): ChildProcess {
  return {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    pid: 99999,
    kill: vi.fn(),
    on: vi.fn(),
  } as unknown as ChildProcess;
}

function discoverServer(
  session: ReturnType<typeof createOpenCodeHttpSession>,
): void {
  session.processStdoutLine(
    "opencode server listening on " + BASE_URL,
  );
}

function sessionResponse() {
  return Promise.resolve({
    ok: true,
    json: async () => ({ id: "ses_123" }),
  });
}

function disposeResponse() {
  return Promise.resolve({ ok: true });
}

function closedEventStream() {
  return Promise.resolve({
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
  });
}

function idleEventStream() {
  const payload = JSON.stringify({
    type: "session.idle",
    properties: { sessionID: "ses_123" },
  });
  return Promise.resolve({
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${payload}\n\n`,
          ),
        );
        controller.close();
      },
    }),
  });
}

async function expectDisposePosted(
  fetchMock: ReturnType<typeof vi.fn>,
): Promise<void> {
  await vi.waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/instance/dispose`,
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
  });
}

async function expectDisposeCleanupStarted(
  warnSpy: ReturnType<typeof vi.spyOn>,
): Promise<void> {
  await vi.waitFor(() => {
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "reason=opencode_dispose_completed",
      ),
    );
  });
}

describe("OpenCodeHttpSession disposal", () => {
  it("does not abort a turn after SSE session_idle", async () => {
    vi.useFakeTimers();
    let resolveMessage:
      ((value: Response) => void) | null = null;
    const messagePromise = new Promise<Response>(
      (resolve) => { resolveMessage = resolve; },
    );
    const fetchMock = vi.fn((url: string | URL) => {
      const target = String(url);
      if (target.endsWith("/session")) return sessionResponse();
      if (target.endsWith("/event")) return idleEventStream();
      if (target.endsWith("/message")) return messagePromise;
      return disposeResponse();
    });
    vi.spyOn(process, "kill").mockImplementation(() => true);
    const warnSpy = vi.spyOn(console, "warn")
      .mockImplementation(() => { /* quiet */ });
    vi.stubGlobal("fetch", fetchMock);
    const onEvent = vi.fn();
    const session = createOpenCodeHttpSession(
      onEvent, vi.fn(),
    );
    discoverServer(session);

    const child = makeChild();
    expect(session.startTurn(child, "hello")).toBe(true);
    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledWith(
        expect.stringContaining("session_idle"),
      );
    });

    expect(session.interruptTurn(child)).toBe(true);
    await expectDisposePosted(fetchMock);
    const abortCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url).endsWith(
        "/session/ses_123/abort",
      ),
    );
    expect(abortCalls).toEqual([]);
    await expectDisposeCleanupStarted(warnSpy);
    resolveMessage!(new Response(
      JSON.stringify({ parts: [] }),
    ));
  });

  it("interruptTurn disposes and reaps a ready server", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((url: string | URL) => {
      const target = String(url);
      if (target.endsWith("/session")) return sessionResponse();
      if (target.endsWith("/event")) return closedEventStream();
      if (target.endsWith("/message")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ parts: [] }),
        });
      }
      return disposeResponse();
    });
    vi.spyOn(process, "kill").mockImplementation(() => true);
    const warnSpy = vi.spyOn(console, "warn")
      .mockImplementation(() => { /* quiet */ });
    vi.stubGlobal("fetch", fetchMock);
    const session = createOpenCodeHttpSession(
      vi.fn(), vi.fn(),
    );
    discoverServer(session);

    const child = makeChild();
    expect(session.startTurn(child, "hello")).toBe(true);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    expect(session.interruptTurn(child)).toBe(true);
    await expectDisposePosted(fetchMock);
    await expectDisposeCleanupStarted(warnSpy);
  });
});
