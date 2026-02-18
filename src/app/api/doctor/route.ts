import { NextRequest, NextResponse } from "next/server";
import { runDoctor, runDoctorFix, streamDoctor, type FixStrategies } from "@/lib/doctor";

/** GET /api/doctor — run diagnostics and return the report.
 *  Pass ?stream=1 for NDJSON streaming (one JSON line per check category).
 */
export async function GET(req: NextRequest) {
  const wantStream = req.nextUrl.searchParams.get("stream") === "1";

  if (wantStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of streamDoctor()) {
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          controller.enqueue(encoder.encode(JSON.stringify({ error: msg }) + "\n"));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
        "Transfer-Encoding": "chunked",
      },
    });
  }

  try {
    const report = await runDoctor();
    return NextResponse.json({ ok: true, data: report });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** POST /api/doctor — run diagnostics and fix issues using provided strategies.
 *  Body: { strategies?: Record<string, string> }
 *  When strategies is provided, only approved checks are fixed.
 *  When omitted, all fixable issues use their default strategy (backwards compat).
 */
export async function POST(req: NextRequest) {
  try {
    let strategies: FixStrategies | undefined;
    try {
      const body = await req.json();
      if (body && typeof body === "object" && body.strategies) {
        strategies = body.strategies as FixStrategies;
      }
    } catch {
      // Empty body or invalid JSON — apply all fixes with defaults (backwards compat)
    }
    const fixReport = await runDoctorFix(strategies);
    return NextResponse.json({ ok: true, data: fixReport });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
