import { NextResponse } from "next/server";
import { scanForAgents } from "@/lib/settings";

export async function GET() {
  try {
    const agents = scanForAgents();
    return NextResponse.json({ ok: true, data: agents });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
