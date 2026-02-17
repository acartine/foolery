import { NextRequest } from "next/server";
import { getOrchestrationSession } from "@/lib/orchestration-manager";
import type { OrchestrationEvent } from "@/lib/types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const entry = getOrchestrationSession(sessionId);

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

      const send = (event: OrchestrationEvent) => {
        if (closed) return;
        try {
          const payload = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // stream is closed
        }
      };

      const cleanup = () => {
        entry.emitter.off("data", listener);
      };

      const closeStream = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // noop
        }
      };

      for (const event of entry.buffer) {
        send(event);
      }

      const listener = (event: OrchestrationEvent) => {
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
