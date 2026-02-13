import { NextRequest, NextResponse } from "next/server";
import { applyOrchestrationSession } from "@/lib/orchestration-manager";
import type { ApplyOrchestrationOverrides } from "@/lib/types";

function parseStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => {
      return typeof entry[1] === "string" && entry[1].trim().length > 0;
    })
    .map(([key, text]) => [key, text.trim()]);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const sessionId =
    typeof body?.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim()
      : "";
  const repoPath =
    typeof body?._repo === "string" && body._repo.trim()
      ? body._repo.trim()
      : "";

  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 }
    );
  }

  if (!repoPath) {
    return NextResponse.json(
      { error: "_repo is required" },
      { status: 400 }
    );
  }

  const overrides: ApplyOrchestrationOverrides = {
    waveNames: parseStringMap(body?.waveNames),
    waveSlugs: parseStringMap(body?.waveSlugs),
  };

  try {
    const result = await applyOrchestrationSession(sessionId, repoPath, overrides);
    return NextResponse.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to apply plan";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
