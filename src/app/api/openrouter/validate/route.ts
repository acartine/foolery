import { NextRequest, NextResponse } from "next/server";
import { validateOpenRouterApiKey } from "@/lib/openrouter";
import { z } from "zod/v4";

const validateBody = z.object({
  apiKey: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const body = validateBody.parse(await request.json());
    const valid = await validateOpenRouterApiKey(body.apiKey);
    return NextResponse.json({ ok: true, data: { valid } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
}
