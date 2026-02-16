import { NextRequest, NextResponse } from "next/server";
import { loadSettings, updateSettings } from "@/lib/settings";
import { actionAgentMappingsSchema } from "@/lib/schemas";

export async function GET() {
  const settings = await loadSettings();
  return NextResponse.json({ ok: true, data: settings.actions });
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const partial = actionAgentMappingsSchema.parse({
      ...(await loadSettings()).actions,
      ...body,
    });
    const updated = await updateSettings({ actions: partial });
    return NextResponse.json({ ok: true, data: updated.actions });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
}
