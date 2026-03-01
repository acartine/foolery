import { type NextRequest, NextResponse } from "next/server";
import { getBackendCapabilitiesForRepo } from "@/lib/backend-instance";

export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("repo") || undefined;
  const capabilities = getBackendCapabilitiesForRepo(repoPath);
  return NextResponse.json({ data: capabilities });
}
