import { NextRequest, NextResponse } from "next/server";
import { logClientPerfEvent } from "@/lib/server-logger";
import { PERF_SCHEMA_VERSION, type ClientPerfEvent } from "@/lib/perf-events";

interface PerfRequestBody {
  schemaVersion?: number;
  events?: ClientPerfEvent[];
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PerfRequestBody;
    if (body.schemaVersion !== PERF_SCHEMA_VERSION || !Array.isArray(body.events)) {
      return NextResponse.json(
        { error: "Invalid diagnostics payload" },
        { status: 400 },
      );
    }

    for (const event of body.events) {
      if (!event || typeof event !== "object" || typeof event.kind !== "string") {
        continue;
      }
      logClientPerfEvent(event);
    }

    return NextResponse.json({ ok: true, count: body.events.length });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Failed to ingest diagnostics";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
