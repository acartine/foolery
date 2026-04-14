import { NextRequest } from "next/server";

export function parseRepoPath(
  request: Request | NextRequest,
  body?: Record<string, unknown>,
): string | undefined {
  const searchParams =
    "nextUrl" in request
      ? request.nextUrl.searchParams
      : new URL(request.url).searchParams;
  const fromQuery =
    searchParams.get("repoPath") ??
    searchParams.get("_repo");
  if (fromQuery?.trim()) return fromQuery.trim();

  const fromBody =
    typeof body?.repoPath === "string"
      ? body.repoPath
      : typeof body?._repo === "string"
        ? body._repo
        : "";
  const trimmed = fromBody.trim();
  return trimmed || undefined;
}

export function getPlanRouteError(
  error: unknown,
  fallback: string,
): {
  message: string;
  status: number;
} {
  const message =
    error instanceof Error ? error.message : fallback;
  const normalized = message.toLowerCase();
  if (normalized.includes("not found")) {
    return { message, status: 404 };
  }
  if (
    normalized.includes("not pending") ||
    normalized.includes("not in progress") ||
    normalized.includes("incomplete predecessors") ||
    normalized.includes("not shipped") ||
    normalized.includes("multiple plans match") ||
    normalized.includes("max concurrent sessions") ||
    normalized.includes("already complete")
  ) {
    return { message, status: 409 };
  }
  return { message, status: 400 };
}
