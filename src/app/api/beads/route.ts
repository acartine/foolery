import { NextRequest, NextResponse } from "next/server";
import { listBeads, createBead } from "@/lib/bd";
import { createBeadSchema } from "@/lib/schemas";

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const result = await listBeads(params);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ data: result.data });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createBeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }
  const { title, description, type, priority, labels, assignee, due, acceptance, parent, estimate } = parsed.data;
  const fields: Record<string, string | string[] | number | undefined> = {
    title,
    description,
    type,
    priority,
    labels,
    assignee,
    due,
    acceptance,
    parent,
    estimate,
  };
  const result = await createBead(fields);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ data: result.data }, { status: 201 });
}
