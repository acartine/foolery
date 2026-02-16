import { NextResponse } from "next/server";
import { getReleaseVersionStatus } from "@/lib/release-version";

export async function GET() {
  const data = await getReleaseVersionStatus();
  return NextResponse.json({ ok: true, data });
}
