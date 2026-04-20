/**
 * Helper functions for the KnotsBackend.  Extracted from
 * knots-backend.ts to stay within the 500-line file limit.
 */

import type { BackendResult } from "@/lib/backend-port";
import type { BackendErrorCode } from "@/lib/backend-errors";
import { isRetryableByDefault } from "@/lib/backend-errors";
import type { Invariant } from "@/lib/types";
import type {
  KnotEdge,
  KnotRecord,
} from "@/lib/knots";
import * as knots from "@/lib/knots";

// ── Result helpers ──────────────────────────────────────────────────

export function ok<T>(data: T): BackendResult<T> {
  return { ok: true, data };
}

export function backendError(
  code: BackendErrorCode,
  message: string,
): BackendResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: isRetryableByDefault(code),
    },
  };
}

export function propagateError<T>(
  result: BackendResult<unknown>,
): BackendResult<T> {
  return { ok: false, error: result.error };
}

export function classifyKnotsError(
  message: string,
): BackendErrorCode {
  const lower = message.toLowerCase();

  if (
    lower.includes("not found") ||
    lower.includes("no such") ||
    lower.includes("local cache")
  ) {
    return "NOT_FOUND";
  }
  if (
    lower.includes("already exists") ||
    lower.includes("duplicate")
  ) {
    return "ALREADY_EXISTS";
  }
  if (
    lower.includes("invalid") ||
    lower.includes("unsupported") ||
    lower.includes("requires at least one field change") ||
    lower.includes("priority must be")
  ) {
    return "INVALID_INPUT";
  }
  if (
    lower.includes("timed out") ||
    lower.includes("timeout")
  ) {
    return "TIMEOUT";
  }
  if (
    lower.includes("locked") ||
    lower.includes("lock") ||
    lower.includes("busy")
  ) {
    return "LOCKED";
  }
  if (
    lower.includes("permission denied") ||
    lower.includes("unauthorized")
  ) {
    return "PERMISSION_DENIED";
  }
  if (lower.includes("unavailable")) {
    return "UNAVAILABLE";
  }
  if (lower.includes("rate limit")) {
    return "RATE_LIMITED";
  }
  return "INTERNAL";
}

export function fromKnots<T>(
  result: { ok: boolean; data?: T; error?: string },
): BackendResult<T> {
  if (result.ok) return { ok: true, data: result.data };
  const message = result.error ?? "Unknown knots error";
  const code = classifyKnotsError(message);
  return {
    ok: false,
    error: { code, message, retryable: isRetryableByDefault(code) },
  };
}

export async function loadKnotRecordWithRehydrate(
  id: string,
  repoPath: string,
): Promise<BackendResult<KnotRecord>> {
  const direct = fromKnots(await knots.showKnot(id, repoPath));
  if (direct.ok || direct.error?.code !== "NOT_FOUND") {
    return direct;
  }

  return fromKnots(
    await knots.rehydrateKnot(id, repoPath),
  );
}

// ── Data normalisation ──────────────────────────────────────────────

export function normalizePriority(
  raw: number | null | undefined,
): 0 | 1 | 2 | 3 | 4 {
  if (
    raw === 0 ||
    raw === 1 ||
    raw === 2 ||
    raw === 3 ||
    raw === 4
  )
    return raw;
  return 2;
}

function parseInvariant(input: unknown): Invariant | null {
  if (!input) return null;

  if (typeof input === "string") {
    const match = /^(Scope|State)\s*:\s*(.+)$/.exec(input.trim());
    if (!match) return null;
    const condition = match[2]?.trim();
    if (!condition) return null;
    return { kind: match[1] as Invariant["kind"], condition };
  }

  if (typeof input === "object") {
    const record = input as Record<string, unknown>;
    const kind = record.kind;
    const rawCondition = record.condition;
    if (
      (kind === "Scope" || kind === "State") &&
      typeof rawCondition === "string"
    ) {
      const condition = rawCondition.trim();
      if (!condition) return null;
      return { kind, condition };
    }
  }

  return null;
}

export function normalizeInvariants(
  invariants: readonly unknown[] | undefined,
): Invariant[] {
  if (!invariants?.length) return [];
  const seen = new Set<string>();
  const normalized: Invariant[] = [];
  for (const inv of invariants) {
    const parsed = parseInvariant(inv);
    if (!parsed) continue;
    const key = `${parsed.kind}:${parsed.condition}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(parsed);
  }
  return normalized;
}

export function serializeInvariants(
  invariants: readonly Invariant[] | undefined,
): string[] | undefined {
  const normalized = normalizeInvariants(invariants);
  if (normalized.length === 0) return undefined;
  return normalized.map(
    (inv) => `${inv.kind}:${inv.condition}`
  );
}

// ── Notes / acceptance ──────────────────────────────────────────────

/** @deprecated Legacy fallback for note-shimmed acceptance criteria. */
const ACCEPTANCE_MARKER = "Acceptance Criteria:\n";

/** @deprecated Legacy fallback for note-shimmed acceptance criteria. */
function isAcceptanceNote(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const content = (entry as Record<string, unknown>).content;
  return (
    typeof content === "string" &&
    content.trimStart().startsWith(ACCEPTANCE_MARKER)
  );
}

/** @deprecated Legacy fallback for note-shimmed acceptance criteria. */
export function extractAcceptanceFromNotes(
  raw: unknown,
): string | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  for (let i = raw.length - 1; i >= 0; i--) {
    const entry = raw[i];
    if (isAcceptanceNote(entry)) {
      const content = (
        (entry as Record<string, unknown>).content as string
      ).trimStart();
      const body = content.slice(ACCEPTANCE_MARKER.length).trim();
      return body.length > 0 ? body : undefined;
    }
  }
  return undefined;
}

export function stringifyNotes(raw: unknown): string | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const parts = raw
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [] as string[];
      if (isAcceptanceNote(entry)) return [] as string[];
      const record = entry as Record<string, unknown>;
      const content =
        typeof record.content === "string"
          ? record.content.trim()
          : "";
      if (!content) return [] as string[];

      const username =
        typeof record.username === "string"
          ? record.username
          : "unknown";
      const datetime =
        typeof record.datetime === "string" ? record.datetime : "";
      const prefix = datetime
        ? `[${datetime}] ${username}`
        : username;
      return [`${prefix}: ${content}`];
    })
    .filter((value) => value.length > 0);

  if (parts.length === 0) return undefined;
  return parts.join("\n\n");
}

// ── Metadata / step extraction ──────────────────────────────────────

function normalizeMetadataEntries(
  raw: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry && typeof entry === "object")
  );
}

export function knotStepEntries(
  knot: KnotRecord,
): Array<Record<string, unknown>> {
  const knotRecord = knot as unknown as Record<string, unknown>;
  const fields: unknown[] = [
    knot.steps,
    knot.step_history,
    knot.stepHistory,
    knot.timeline,
    knot.transitions,
    knotRecord.knotsSteps,
    knotRecord.step_history,
    knotRecord.stepHistory,
    knotRecord.timeline,
    knotRecord.transitions,
  ];

  for (const field of fields) {
    const entries = normalizeMetadataEntries(field);
    if (entries.length > 0) return entries;
  }

  return [];
}

// ── Parent derivation ───────────────────────────────────────────────

function parentFromEdges(
  id: string,
  edges: KnotEdge[],
): string | undefined {
  const parentEdge = edges.find(
    (edge) => edge.kind === "parent_of" && edge.dst === id
  );
  return parentEdge?.src;
}

function parentFromHierarchicalId(
  id: string,
  knownIds: ReadonlySet<string>,
): string | undefined {
  let cursor = id;
  while (cursor.includes(".")) {
    cursor = cursor.slice(0, cursor.lastIndexOf("."));
    if (knownIds.has(cursor)) return cursor;
  }
  return undefined;
}

function parentFromHierarchicalAlias(
  alias: string | null | undefined,
  aliasToId: ReadonlyMap<string, string>,
  knownIds: ReadonlySet<string>,
): string | undefined {
  if (!alias) return undefined;
  let cursor = alias;
  while (cursor.includes(".")) {
    cursor = cursor.slice(0, cursor.lastIndexOf("."));
    const resolvedId = aliasToId.get(cursor);
    if (resolvedId !== undefined) return resolvedId;
    if (knownIds.has(cursor)) return cursor;
    const stripped = cursor.replace(/^[^-]+-/, "");
    if (stripped !== cursor) {
      const strippedResolved = aliasToId.get(stripped);
      if (strippedResolved !== undefined) return strippedResolved;
      if (knownIds.has(stripped)) return stripped;
    }
  }
  return undefined;
}

export function deriveParentId(
  id: string,
  alias: string | null | undefined,
  edges: KnotEdge[],
  knownIds: ReadonlySet<string>,
  aliasToId: ReadonlyMap<string, string>,
): string | undefined {
  return (
    parentFromEdges(id, edges) ??
    parentFromHierarchicalId(id, knownIds) ??
    parentFromHierarchicalAlias(alias, aliasToId, knownIds)
  );
}

// ── Edge utilities ──────────────────────────────────────────────────

export function isBlockedByEdges(
  id: string,
  edges: KnotEdge[],
): boolean {
  return edges.some(
    (edge) => edge.kind === "blocked_by" && edge.src === id
  );
}

export function normalizeProfileId(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

export function collectAliases(knot: KnotRecord): string[] {
  const result = new Set<string>();
  if (typeof knot.alias === "string" && knot.alias.trim()) {
    result.add(knot.alias.trim());
  }
  if (Array.isArray(knot.aliases)) {
    for (const item of knot.aliases) {
      if (typeof item === "string" && item.trim())
        result.add(item.trim());
    }
  }
  return Array.from(result);
}
