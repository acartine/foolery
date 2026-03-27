import { NextRequest, NextResponse } from "next/server";
import {
  isAllowedLocalUpdateRequest,
  readAppUpdateStatus,
  startAppUpdate,
} from "@/lib/app-update";

export async function GET() {
  const data = await readAppUpdateStatus();
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  if (!isAllowedLocalUpdateRequest(request)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403 },
    );
  }

  try {
    const result = await startAppUpdate();
    return NextResponse.json(
      { data: result.status },
      { status: result.started ? 202 : 409 },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to start update";
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
