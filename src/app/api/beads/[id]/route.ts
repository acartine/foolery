import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import { backendErrorStatus } from "@/lib/backend-http";
import { updateBeadSchema } from "@/lib/schemas";
import { regroomAncestors } from "@/lib/regroom";
import { LABEL_TRANSITION_VERIFICATION } from "@/lib/verification-workflow";
import {
  DEGRADED_ERROR_MESSAGE,
  isSuppressibleError,
} from "@/lib/bd-error-suppression";
import type { Bead } from "@/lib/types";

const DETAIL_CACHE_TTL_MS = 10 * 60 * 1000;
const NOT_FOUND_PATTERNS = [
  "no issue found",
  "no issues found",
  "not found",
];

interface DetailCacheEntry {
  bead: Bead;
  cachedAtMs: number;
}

const detailCache = new Map<string, DetailCacheEntry>();

function cacheKey(id: string, repoPath?: string): string {
  return `${repoPath ?? ""}::${id}`;
}

function cacheDetail(id: string, repoPath: string | undefined, bead: Bead): void {
  detailCache.set(cacheKey(id, repoPath), {
    bead,
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

  const error = result.error?.message ?? "Failed to fetch bead";
  if (isSuppressibleError(error)) {
    const cached = getCachedDetail(id, repoPath);
    if (cached) {
      return NextResponse.json({
        data: cached.bead,
        cached: true,
        cachedAt: new Date(cached.cachedAtMs).toISOString(),
      });
    }
    return NextResponse.json({ error: DEGRADED_ERROR_MESSAGE }, { status: 503 });
  }

  if (result.error?.code === "NOT_FOUND" || isNotFoundError(error)) {
    return NextResponse.json({ error }, { status: 404 });
  }
  return NextResponse.json({ error }, { status: backendErrorStatus(result.error) });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { _repo: repoPath, ...rest } = body;
  const parsed = updateBeadSchema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  // Enforce edit lock: reject mutations when transition:verification is active
  const backend = getBackend();
  const current = await backend.get(id, repoPath);
  const canonicalId = current.ok && current.data ? current.data.id : id;
  if (current.ok && current.data) {
    const labels = current.data.labels ?? [];
    if (labels.includes(LABEL_TRANSITION_VERIFICATION)) {
      return NextResponse.json(
        { error: "Bead is locked during auto-verification. Edits are disabled until verification completes." },
        { status: 409 }
      );
    }
  }

  const result = await backend.update(canonicalId, parsed.data, repoPath);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error?.message },
      { status: backendErrorStatus(result.error) },
    );
  }
  clearCachedDetail(id, repoPath);
  if (canonicalId !== id) clearCachedDetail(canonicalId, repoPath);

  // Regroom ancestors when a bead leaves verification state.
  const transitionedOutOfVerification =
    typeof parsed.data.workflowState === "string" &&
    parsed.data.workflowState.trim().toLowerCase() !== "verification";
  if (transitionedOutOfVerification) {
    // Fire-and-forget: don't block the HTTP response on ancestor regroom
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

  // Enforce edit lock: reject deletes when transition:verification is active
  const backend = getBackend();
  const currentBead = await backend.get(id, repoPath);
  const canonicalId = currentBead.ok && currentBead.data ? currentBead.data.id : id;
  if (currentBead.ok && currentBead.data) {
    const labels = currentBead.data.labels ?? [];
    if (labels.includes(LABEL_TRANSITION_VERIFICATION)) {
      return NextResponse.json(
        { error: "Bead is locked during auto-verification. Deletion is disabled until verification completes." },
        { status: 409 }
      );
    }
  }

  const result = await backend.delete(canonicalId, repoPath);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error?.message },
      { status: backendErrorStatus(result.error) },
    );
  }
  clearCachedDetail(id, repoPath);
  if (canonicalId !== id) clearCachedDetail(canonicalId, repoPath);
  return NextResponse.json({ ok: true });
}
