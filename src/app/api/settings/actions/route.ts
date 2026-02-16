import { NextRequest, NextResponse } from "next/server";
import { loadSettings, updateSettings } from "@/lib/settings";

export async function GET() {
  const settings = await loadSettings();
  return NextResponse.json({ ok: true, data: settings.actions });
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    // Pass the partial directly; updateSettings does an atomic
    // read-merge-write using the freshest cached settings.
    const updated = await updateSettings({ actions: body });
    return NextResponse.json({ ok: true, data: updated.actions });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
}
