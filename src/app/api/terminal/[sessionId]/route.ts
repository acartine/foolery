import { NextRequest } from "next/server";
import { getSession } from "@/lib/terminal-manager";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const entry = getSession(sessionId);

  if (!entry) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (event: { type: string; data: string; timestamp: number }) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          // stream closed
        }
      };

      // Replay buffered events
      for (const evt of entry.buffer) {
        send(evt);
      }

      // Subscribe to new events
      const listener = (evt: { type: string; data: string; timestamp: number }) => {
        send(evt);
        if (evt.type === "exit") {
          try { controller.close(); } catch { /* already closed */ }
        }
      };
      entry.emitter.on("data", listener);

      // If process already exited and we've replayed all, close
      if (entry.session.status !== "running" && entry.session.status !== "idle") {
        const hasExit = entry.buffer.some((e) => e.type === "exit");
        if (hasExit) {
          try { controller.close(); } catch { /* already closed */ }
        }
      }

      // Handle client disconnect
      request.signal.addEventListener("abort", () => {
        entry.emitter.off("data", listener);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
