import { NextResponse } from "next/server";
import {
  getBeatsSyncState,
  triggerBeatsSync,
} from "@/lib/beats-sync-service";
import { logApiError } from "@/lib/server-logger";

const PATH = "/api/sync/beats";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function GET() {
  try {
    return NextResponse.json(await getBeatsSyncState());
  } catch (error) {
    logApiError({
      method: "GET",
      path: PATH,
      status: 500,
      error: errorMessage(error),
    });
    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    return NextResponse.json(await triggerBeatsSync());
  } catch (error) {
    logApiError({
      method: "POST",
      path: PATH,
      status: 500,
      error: errorMessage(error),
    });
    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 500 },
    );
  }
}
