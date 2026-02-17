import { NextRequest, NextResponse } from "next/server";
import { runDoctor, runDoctorFix, type FixStrategies } from "@/lib/doctor";

/** GET /api/doctor — run diagnostics and return the report. */
export async function GET() {
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
