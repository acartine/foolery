import { NextRequest } from "next/server";
import { getHydrationSession } from "@/lib/hydration-manager";
import type { HydrationEvent } from "@/lib/types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const entry = getHydrationSession(sessionId);

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

      const send = (event: HydrationEvent) => {
        if (closed) return;
        try {
          const payload = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // stream is closed
        }
      };

      const closeStream = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // noop
        }
      };

      for (const event of entry.buffer) {
        send(event);
      }

      const listener = (event: HydrationEvent) => {
        send(event);
        if (event.type === "exit") {
          setTimeout(closeStream, 100);
        }
      };

      entry.emitter.on("data", listener);

      if (entry.session.status !== "running") {
        const hasExit = entry.buffer.some((event) => event.type === "exit");
        if (hasExit) setTimeout(closeStream, 200);
      }

      request.signal.addEventListener("abort", () => {
        entry.emitter.off("data", listener);
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
