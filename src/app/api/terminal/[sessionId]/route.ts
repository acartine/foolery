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
      let closed = false;

      const send = (event: { type: string; data: string; timestamp: number }) => {
        if (closed) return;
        try {
          const payload = `data: ${JSON.stringify(event)}\n\n`;
          console.log(`[terminal-sse] [${sessionId}] sending ${event.type} (${event.data.length} chars)`);
          controller.enqueue(encoder.encode(payload));
        } catch {
          // stream closed
        }
      };

      const cleanup = () => {
        entry.emitter.off("data", listener);
      };

      const closeStream = () => {
        if (closed) return;
        closed = true;
        cleanup();
        console.log(`[terminal-sse] [${sessionId}] closing stream`);
        try { controller.close(); } catch { /* already closed */ }
      };

      console.log(`[terminal-sse] [${sessionId}] connected, buffer=${entry.buffer.length} events, status=${entry.session.status}`);

      // Replay buffered events
      for (const evt of entry.buffer) {
        send(evt);
      }

      // Send a synthetic stream_end event so the client can distinguish
      // a clean server-initiated close from an unexpected network drop.
      const sendStreamEnd = () => {
        send({ type: "stream_end", data: "", timestamp: Date.now() });
      };

      // Subscribe to new events
      const listener = (evt: { type: string; data: string; timestamp: number }) => {
        send(evt);
        if (evt.type === "exit") {
          // Give the browser time to process exit before closing the stream.
          setTimeout(() => { sendStreamEnd(); closeStream(); }, 100);
        }
      };
      entry.emitter.on("data", listener);

      // If process already exited and we've replayed all, close after delay
      if (entry.session.status !== "running" && entry.session.status !== "idle") {
        const hasExit = entry.buffer.some((e) => e.type === "exit");
        if (hasExit) {
          // Give the browser time to process replayed events before closing
          setTimeout(() => { sendStreamEnd(); closeStream(); }, 250);
        }
      }

      // Handle client disconnect
      request.signal.addEventListener("abort", () => {
        closeStream();
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
