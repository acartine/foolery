import { type NextRequest, NextResponse } from "next/server";
import { getReleaseVersionStatus } from "@/lib/release-version";

export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("force") === "1";
  const data = await getReleaseVersionStatus(force);
  return NextResponse.json({ ok: true, data });
}
