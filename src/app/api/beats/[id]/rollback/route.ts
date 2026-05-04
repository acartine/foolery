import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import {
  backendErrorStatus,
  withDispatchFailureHandling,
} from "@/lib/backend-http";
import {
  resolveMemoryManagerType,
  rollbackBeatState,
} from "@/lib/memory-manager-commands";
import { closeBeatSchema } from "@/lib/schemas";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const { _repo: repoPath, ...rest } = body;
  const parsed = closeBeatSchema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  return withDispatchFailureHandling(async () => {
    const backend = getBackend();
    const current = await backend.get(id, repoPath);
    if (!current.ok || !current.data) {
      return NextResponse.json(
        { error: current.error?.message ?? "Beat not found" },
        { status: backendErrorStatus(current.error) },
      );
    }

    const memoryManagerType = resolveMemoryManagerType(
      typeof repoPath === "string" ? repoPath : process.cwd(),
    );
    if (memoryManagerType !== "knots") {
      return NextResponse.json(
        { error: "Release rollback is only available for Knots beats." },
        { status: 400 },
      );
    }

    try {
      await rollbackBeatState(
        current.data.id,
        current.data.state,
        "unknown",
        repoPath,
        memoryManagerType,
        parsed.data.reason,
      );
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : "Failed to release beat";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  });
}
