import { NextResponse } from "next/server";
import { runDoctor, runDoctorFix } from "@/lib/doctor";

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

/** POST /api/doctor — run diagnostics and auto-fix fixable issues. */
export async function POST() {
  try {
    const fixReport = await runDoctorFix();
    return NextResponse.json({ ok: true, data: fixReport });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
