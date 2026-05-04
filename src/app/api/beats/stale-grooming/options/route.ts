import { NextResponse } from "next/server";
import {
  listStaleBeatGroomingAgentOptions,
} from "@/lib/stale-beat-grooming-agent";

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      data: await listStaleBeatGroomingAgentOptions(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error
          ? error.message
          : String(error),
      },
      { status: 400 },
    );
  }
}
