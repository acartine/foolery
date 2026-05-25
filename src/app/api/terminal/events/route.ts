import { NextRequest } from "next/server";
import { getSession } from "@/lib/terminal-manager";
import { withServerTiming } from "@/lib/server-timing";
import type { TerminalEvent } from "@/lib/types";
import type { TerminalStreamEnvelope } from "@/lib/terminal-api";
import type { SessionEntry } from "@/lib/terminal-manager-types";

const STREAM_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

export async function GET(request: NextRequest) {
  const sessionIds = parseSessionIds(request.nextUrl.searchParams);
  return withServerTiming(
    {
      route: "GET /api/terminal/events",
      context: { sessionCount: sessionIds.length },
    },
    async () => {
      if (sessionIds.length === 0) {
        return new Response(
          JSON.stringify({ error: "sessionIds query parameter is required" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      const stream = createTerminalEventsStream(request, sessionIds);
      return new Response(stream, { headers: STREAM_HEADERS });
    },
  );
}

function parseSessionIds(searchParams: URLSearchParams): string[] {
  const values = [
    ...searchParams.getAll("sessionId"),
    ...searchParams.getAll("sessionIds"),
  ];
  const sessionIds = values.flatMap((value) => value.split(","));
  return [...new Set(sessionIds.map((id) => id.trim()).filter(Boolean))];
}

function createTerminalEventsStream(
  request: NextRequest,
  sessionIds: string[],
): ReadableStream<Uint8Array> {
  let cleanupStream = () => {};
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const openIds = new Set(sessionIds);
      const cleanupFns: Array<() => void> = [];
      let closed = false;

      const send = (sessionId: string, event: TerminalEvent) => {
        if (closed) return;
        const envelope = { sessionId, event } satisfies TerminalStreamEnvelope;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      const sendComment = (comment: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ${comment}\n\n`));
        } catch {
          closed = true;
        }
      };

      const closeStream = () => {
        if (closed) return;
        closed = true;
        for (const cleanup of cleanupFns) cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      cleanupStream = closeStream;
      sendComment(`terminal-events sessions=${sessionIds.length}`);

      const closeSession = (sessionId: string) => {
        if (!openIds.has(sessionId)) return;
        send(sessionId, { type: "stream_end", data: "", timestamp: Date.now() });
        openIds.delete(sessionId);
        if (openIds.size === 0) closeStream();
      };

      for (const sessionId of sessionIds) {
        const cleanup = subscribeSession(sessionId, send, closeSession);
        cleanupFns.push(cleanup);
      }

      request.signal.addEventListener("abort", closeStream, { once: true });
      if (openIds.size === 0) closeStream();
    },
    cancel() {
      cleanupStream();
    },
  });
}

function subscribeSession(
  sessionId: string,
  send: (sessionId: string, event: TerminalEvent) => void,
  closeSession: (sessionId: string) => void,
): () => void {
  const entry = getSession(sessionId);
  if (!entry) {
    sendSyntheticExit(sessionId, null, send);
    closeSession(sessionId);
    return () => {};
  }

  const listener = (event: TerminalEvent) => {
    send(sessionId, event);
    if (event.type === "exit") {
      setTimeout(() => closeSession(sessionId), 100);
    }
  };
  entry.emitter.on("data", listener);
  replaySessionBuffer(sessionId, entry, send, closeSession);
  return () => {
    entry.emitter.off("data", listener);
  };
}

function replaySessionBuffer(
  sessionId: string,
  entry: SessionEntry,
  send: (sessionId: string, event: TerminalEvent) => void,
  closeSession: (sessionId: string) => void,
): void {
  let hasExit = false;
  for (const event of [...entry.buffer]) {
    if (event.type === "exit") hasExit = true;
    send(sessionId, event);
  }
  if (entry.session.status === "running" || entry.session.status === "idle") {
    return;
  }
  if (!hasExit) sendSyntheticExit(sessionId, entry, send);
  setTimeout(() => closeSession(sessionId), 250);
}

function sendSyntheticExit(
  sessionId: string,
  entry: SessionEntry | null,
  send: (sessionId: string, event: TerminalEvent) => void,
): void {
  const exitCode = syntheticExitCode(entry);
  send(sessionId, {
    type: "exit",
    data: String(exitCode),
    timestamp: Date.now(),
  });
}

function syntheticExitCode(entry: SessionEntry | null): number {
  if (!entry || entry.session.status === "disconnected") return -2;
  return entry.session.exitCode
    ?? (entry.session.status === "completed" ? 0 : 1);
}
