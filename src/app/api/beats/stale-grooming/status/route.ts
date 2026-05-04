import { NextResponse } from "next/server";
import {
  getStaleBeatGroomingQueueSize,
} from "@/lib/stale-beat-grooming-queue";
import {
  listStaleBeatGroomingReviews,
} from "@/lib/stale-beat-grooming-store";
import {
  getStaleBeatGroomingWorkerHealth,
  startStaleBeatGroomingWorker,
} from "@/lib/stale-beat-grooming-worker";

export async function GET() {
  startStaleBeatGroomingWorker();
  return NextResponse.json({
    ok: true,
    data: {
      queueSize: getStaleBeatGroomingQueueSize(),
      reviews: listStaleBeatGroomingReviews(),
      worker: getStaleBeatGroomingWorkerHealth(),
    },
  });
}
