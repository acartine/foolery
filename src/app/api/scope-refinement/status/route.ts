import { NextResponse } from "next/server";
import { listScopeRefinementCompletions } from "@/lib/scope-refinement-events";
import { getScopeRefinementQueueSize } from "@/lib/scope-refinement-queue";
import { startScopeRefinementWorker } from "@/lib/scope-refinement-worker";

export async function GET() {
  startScopeRefinementWorker();
  return NextResponse.json({
    data: {
      queueSize: getScopeRefinementQueueSize(),
      completions: listScopeRefinementCompletions(),
    },
  });
}
