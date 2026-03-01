import { NextResponse } from "next/server";
import { fetchOpenRouterModels } from "@/lib/openrouter";

export async function GET() {
  try {
    const models = await fetchOpenRouterModels();
    return NextResponse.json({ ok: true, data: models });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 502 },
    );
  }
}
