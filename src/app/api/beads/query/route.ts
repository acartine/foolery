import { NextRequest, NextResponse } from "next/server";
import { queryBeads } from "@/lib/bd";
import { queryBeadSchema } from "@/lib/schemas";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = queryBeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }
  const { expression, limit, sort } = parsed.data;
  const result = await queryBeads(expression, { limit, sort });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ data: result.data });
}
