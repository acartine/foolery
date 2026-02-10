import { NextRequest, NextResponse } from "next/server";
import { listDirectory } from "@/lib/browse";

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path") || undefined;
  const entries = await listDirectory(path);
  return NextResponse.json({ data: entries });
}
