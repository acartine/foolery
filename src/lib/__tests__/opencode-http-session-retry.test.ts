import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import {
  createOpenCodeHttpSession,
} from "@/lib/opencode-http-session";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function makeChild(): ChildProcess {
  return {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    pid: 70707,
    kill: vi.fn(),
    on: vi.fn(),
  } as unknown as ChildProcess;
}

function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function eventStream(...events: unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify(event)}\n\n`,
          ),
        );
      }
      controller.close();
    },
  }), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function messageCalls(
  fetchMock: ReturnType<typeof vi.fn>,
): unknown[][] {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).endsWith("/message"),
  );
}

describe("OpenCode HTTP message retry backoff", () => {
  it("retries delivery failures with 8/16/32s backoff", async () => {
    vi.useFakeTimers();
    const messageResponses: Array<Response | null> = [
      null,
      null,
      null,
      jsonResponse({
        parts: [{ type: "text", text: "delivered" }],
      }),
    ];
    const fetchMock = vi.fn(async (url: string | URL) => {
      const target = String(url);
      if (target.endsWith("/session")) {
        return jsonResponse({ id: "ses_retry" });
      }
      if (target.endsWith("/event")) return eventStream();
      if (target.endsWith("/message")) {
        const next = messageResponses.shift();
        if (next === null) throw new TypeError("fetch failed");
        if (!next) throw new TypeError("missing stub");
        return next;
      }
      throw new TypeError(`unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const onEvent = vi.fn();
    const onError = vi.fn();
    const session = createOpenCodeHttpSession(
      onEvent, onError,
    );

    session.processStdoutLine(
      "opencode server listening on http://127.0.0.1:4096",
    );
    expect(session.startTurn(makeChild(), "hello")).toBe(true);
    await vi.waitFor(() => {
      expect(messageCalls(fetchMock)).toHaveLength(1);
    });

    await vi.advanceTimersByTimeAsync(8_000);
    await vi.waitFor(() => {
      expect(messageCalls(fetchMock)).toHaveLength(2);
    });
    await vi.advanceTimersByTimeAsync(16_000);
    await vi.waitFor(() => {
      expect(messageCalls(fetchMock)).toHaveLength(3);
    });
    await vi.advanceTimersByTimeAsync(32_000);
    await vi.waitFor(() => {
      expect(messageCalls(fetchMock)).toHaveLength(4);
    });

    await flushAsync();
    expect(onEvent).toHaveBeenCalledWith(
      JSON.stringify({
        type: "text",
        part: { text: "delivered" },
      }),
    );
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("retrying in 8s"),
    );
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("retrying in 16s"),
    );
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("retrying in 32s"),
    );
  });
});

describe("OpenCode HTTP message retry safety", () => {
  it("does not retry after SSE shows turn activity", async () => {
    let rejectMessage:
      ((reason?: unknown) => void) | undefined;
    const fetchMock = vi.fn((url: string | URL) => {
      const target = String(url);
      if (target.endsWith("/session")) {
        return Promise.resolve(jsonResponse({ id: "ses_busy" }));
      }
      if (target.endsWith("/event")) {
        return Promise.resolve(eventStream({
          type: "message.part.updated",
          properties: {
            part: { type: "text", text: "started" },
          },
        }));
      }
      if (target.endsWith("/message")) {
        return new Promise<Response>((_, reject) => {
          rejectMessage = reject;
        });
      }
      return Promise.reject(
        new TypeError(`unexpected fetch ${target}`),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const onEvent = vi.fn();
    const onError = vi.fn();
    const session = createOpenCodeHttpSession(
      onEvent, onError,
    );

    session.processStdoutLine(
      "opencode server listening on http://127.0.0.1:4096",
    );
    expect(session.startTurn(makeChild(), "hello")).toBe(true);
    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledWith(
        JSON.stringify({
          type: "text",
          part: { text: "started" },
        }),
      );
    });

    rejectMessage?.(new TypeError("fetch failed"));
    await flushAsync();

    expect(messageCalls(fetchMock)).toHaveLength(1);
    expect(onError).not.toHaveBeenCalledWith(
      expect.stringContaining("retrying in"),
    );
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining(
        "Waiting for session.idle from SSE stream",
      ),
    );
  });
});
