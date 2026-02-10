import { NextRequest, NextResponse } from "next/server";
import { readyBeads } from "@/lib/bd";

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const result = await readyBeads(params);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ data: result.data });
}
