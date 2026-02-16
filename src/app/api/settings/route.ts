import { NextRequest, NextResponse } from "next/server";
import { loadSettings, updateSettings } from "@/lib/settings";

export async function GET() {
  const settings = await loadSettings();
  return NextResponse.json({ ok: true, data: settings });
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const updated = await updateSettings(body);
    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
}
