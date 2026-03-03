import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import { backendErrorStatus } from "@/lib/backend-http";
import { updateBeatSchema } from "@/lib/schemas";
import { regroomAncestors } from "@/lib/regroom";
import {
  DEGRADED_ERROR_MESSAGE,
  isSuppressibleError,
} from "@/lib/bd-error-suppression";
import type { Beat } from "@/lib/types";
import { logApiError } from "@/lib/server-logger";

const DETAIL_CACHE_TTL_MS = 10 * 60 * 1000;
const NOT_FOUND_PATTERNS = [
  "no issue found",
  "no issues found",
  "not found",
];

interface DetailCacheEntry {
  beat: Beat;
  cachedAtMs: number;
}

const detailCache = new Map<string, DetailCacheEntry>();

function cacheKey(id: string, repoPath?: string): string {
  return `${repoPath ?? ""}::${id}`;
}

function cacheDetail(id: string, repoPath: string | undefined, beat: Beat): void {
  detailCache.set(cacheKey(id, repoPath), {
    beat,
    cachedAtMs: Date.now(),
  });
}

function clearCachedDetail(id: string, repoPath?: string): void {
  detailCache.delete(cacheKey(id, repoPath));
}

function getCachedDetail(id: string, repoPath?: string): DetailCacheEntry | null {
  const key = cacheKey(id, repoPath);
  const cached = detailCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAtMs > DETAIL_CACHE_TTL_MS) {
    detailCache.delete(key);
    return null;
  }
  return cached;
}

function isNotFoundError(errorMsg: string | undefined): boolean {
  if (!errorMsg) return false;
  const lower = errorMsg.toLowerCase();
  return NOT_FOUND_PATTERNS.some((pattern) => lower.includes(pattern));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const repoPath = request.nextUrl.searchParams.get("_repo") || undefined;
  const result = await getBackend().get(id, repoPath);
  if (result.ok && result.data) {
    cacheDetail(id, repoPath, result.data);
    return NextResponse.json({
      data: result.data,
      cached: false,
    });
  }

  const error = result.error?.message ?? "Failed to fetch beat";
  if (isSuppressibleError(error)) {
    const cached = getCachedDetail(id, repoPath);
    if (cached) {
      return NextResponse.json({
        data: cached.beat,
        cached: true,
        cachedAt: new Date(cached.cachedAtMs).toISOString(),
      });
    }
    logApiError({ method: "GET", path: `/api/beads/${id}`, status: 503, error: DEGRADED_ERROR_MESSAGE });
    return NextResponse.json({ error: DEGRADED_ERROR_MESSAGE }, { status: 503 });
  }

  if (result.error?.code === "NOT_FOUND" || isNotFoundError(error)) {
    logApiError({ method: "GET", path: `/api/beads/${id}`, status: 404, error });
    return NextResponse.json({ error }, { status: 404 });
  }
  const getStatus = backendErrorStatus(result.error);
  logApiError({ method: "GET", path: `/api/beads/${id}`, status: getStatus, error });
  return NextResponse.json({ error }, { status: getStatus });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { _repo: repoPath, ...rest } = body;
  const parsed = updateBeatSchema.safeParse(rest);
  if (!parsed.success) {
    logApiError({ method: "PATCH", path: `/api/beads/${id}`, status: 400, error: "Validation failed" });
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const backend = getBackend();
  const current = await backend.get(id, repoPath);
  const canonicalId = current.ok && current.data ? current.data.id : id;

  const result = await backend.update(canonicalId, parsed.data, repoPath);
  if (!result.ok) {
    const updateStatus = backendErrorStatus(result.error);
    logApiError({ method: "PATCH", path: `/api/beads/${id}`, status: updateStatus, error: result.error?.message });
    return NextResponse.json(
      { error: result.error?.message },
      { status: updateStatus },
    );
  }
  clearCachedDetail(id, repoPath);
  if (canonicalId !== id) clearCachedDetail(canonicalId, repoPath);

  // Fire-and-forget: regroom ancestors on state changes
  if (typeof parsed.data.state === "string") {
    regroomAncestors(canonicalId, repoPath).catch((err) =>
      console.error(`[regroom] background error for ${canonicalId}:`, err)
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const repoPath = request.nextUrl.searchParams.get("_repo") || undefined;

  const backend = getBackend();
  const currentBeat = await backend.get(id, repoPath);
  const canonicalId = currentBeat.ok && currentBeat.data ? currentBeat.data.id : id;

  const result = await backend.delete(canonicalId, repoPath);
  if (!result.ok) {
    const deleteStatus = backendErrorStatus(result.error);
    logApiError({ method: "DELETE", path: `/api/beads/${id}`, status: deleteStatus, error: result.error?.message });
    return NextResponse.json(
      { error: result.error?.message },
      { status: deleteStatus },
    );
  }
  clearCachedDetail(id, repoPath);
  if (canonicalId !== id) clearCachedDetail(canonicalId, repoPath);
  return NextResponse.json({ ok: true });
}
