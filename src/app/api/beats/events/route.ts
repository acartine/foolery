import { NextRequest } from "next/server";
import { listRepos } from "@/lib/registry";
import { _resetAggregateBeatsCache } from "@/lib/beats-multi-repo";
import { detectMemoryManagerType } from "@/lib/memory-manager-detection";
import { subscribeBeadsJournal, type JournalNotice } from "@/lib/beads-journal-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const repoPath = request.nextUrl.searchParams.get("_repo");
  const paths = repoPath ? [repoPath] : (await listRepos()).map((repo) => repo.path);
  const forcedBackend = process.env.FOOLERY_BACKEND;
  const beadsPaths = paths.filter((path) => forcedBackend && forcedBackend !== "auto"
    ? forcedBackend === "cli"
    : detectMemoryManagerType(path) === "beads");
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const ready = new Set<string>();
      const subscriptions: Array<() => void> = [];
      let closed = false;
      const send = (value: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      };
      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        subscriptions.forEach((unsubscribe) => unsubscribe());
        request.signal.removeEventListener("abort", stop);
        try { controller.close(); } catch { /* Reader cancellation already closed the stream. */ }
      };
      const onNotice = (notice: JournalNotice) => {
        if (notice.type === "ready" || notice.type === "change") _resetAggregateBeatsCache();
        if (notice.type === "ready") ready.add(notice.repoPath);
        else if (notice.type !== "change") ready.delete(notice.repoPath);
        send({ ...notice, complete: paths.length > 0 && ready.size === paths.length });
      };
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15_000);
      cleanup = stop;
      send({ type: "polling", complete: false });
      for (const path of beadsPaths) subscriptions.push(subscribeBeadsJournal(path, onNotice));
      request.signal.addEventListener("abort", stop, { once: true });
      if (request.signal.aborted) stop();
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
    Connection: "keep-alive", "X-Accel-Buffering": "no",
  } });
}
