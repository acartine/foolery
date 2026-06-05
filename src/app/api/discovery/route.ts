import { NextResponse } from "next/server";
import { discoveryDocument } from "@/lib/openapi/agent-guide";

/**
 * Always-available alias for the machine-discovery document also served at
 * `/.well-known/foolery.json`. Provided under `/api/` so agents that only
 * traverse the documented API namespace can still find the discovery map.
 */
export function GET() {
  return NextResponse.json(discoveryDocument, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
