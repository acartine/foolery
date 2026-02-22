/**
 * JSONL DTO translation helpers for the BeadsBackend.
 *
 * Converts between the JSONL on-disk format (snake_case, bd-specific
 * field names) and the domain Bead type used internally by foolery.
 */

import type { Bead, BeadPriority, BeadStatus, BeadType } from "@/lib/types";

// ── Raw JSONL record shape ──────────────────────────────────────

export interface RawBead {
  id: string;
  title: string;
  description?: string;
  notes?: string;
  acceptance_criteria?: string;
  issue_type?: string;
  status?: string;
  priority?: number;
  labels?: string[];
  assignee?: string;
  owner?: string;
  parent?: string;
  due?: string;
  estimated_minutes?: number;
  created_at?: string;
  created_by?: string;
  updated_at?: string;
  closed_at?: string;
  close_reason?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

// ── JSONL field name constants ──────────────────────────────────

const VALID_TYPES: ReadonlySet<string> = new Set([
  "bug",
  "feature",
  "task",
  "epic",
  "chore",
  "merge-request",
  "molecule",
  "gate",
]);

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "open",
  "in_progress",
  "blocked",
  "deferred",
  "closed",
]);

// ── Parent inference ────────────────────────────────────────────

function inferParent(id: string, explicit?: unknown): string | undefined {
  if (typeof explicit === "string" && explicit) return explicit;
  const dotIdx = id.lastIndexOf(".");
  if (dotIdx === -1) return undefined;
  return id.slice(0, dotIdx);
}

// ── Normalize: JSONL → Domain ───────────────────────────────────

export function normalizeFromJsonl(raw: RawBead): Bead {
  const id = raw.id;
  const rawType = raw.issue_type ?? raw.type ?? "task";
  const type = (VALID_TYPES.has(rawType as string) ? rawType : "task") as BeadType;
  const rawStatus = raw.status ?? "open";
  const status = (VALID_STATUSES.has(rawStatus as string) ? rawStatus : "open") as BeadStatus;
  const rawPriority = raw.priority ?? 2;
  const priority = (typeof rawPriority === "number" && rawPriority >= 0 && rawPriority <= 4
    ? rawPriority
    : 2) as BeadPriority;

  return {
    id,
    title: raw.title,
    description: raw.description,
    notes: raw.notes,
    acceptance: raw.acceptance_criteria ?? (raw as Record<string, unknown>).acceptance as string | undefined,
    type,
    status,
    priority,
    labels: (raw.labels ?? []).filter((l) => l.trim() !== ""),
    assignee: raw.assignee,
    owner: raw.owner,
    parent: inferParent(id, raw.parent),
    due: raw.due,
    estimate: raw.estimated_minutes ?? (raw as Record<string, unknown>).estimate as number | undefined,
    created: (raw.created_at ?? (raw as Record<string, unknown>).created ?? new Date().toISOString()) as string,
    updated: (raw.updated_at ?? (raw as Record<string, unknown>).updated ?? new Date().toISOString()) as string,
    closed: raw.closed_at ?? (raw as Record<string, unknown>).closed as string | undefined,
    metadata: raw.metadata,
  };
}

// ── Denormalize: Domain → JSONL ─────────────────────────────────

export function denormalizeToJsonl(bead: Bead): RawBead {
  const raw: RawBead = {
    id: bead.id,
    title: bead.title,
    status: bead.status,
    priority: bead.priority,
    issue_type: bead.type,
    labels: bead.labels,
    created_at: bead.created,
    updated_at: bead.updated,
  };

  if (bead.description !== undefined) raw.description = bead.description;
  if (bead.notes !== undefined) raw.notes = bead.notes;
  if (bead.acceptance !== undefined) raw.acceptance_criteria = bead.acceptance;
  if (bead.assignee !== undefined) raw.assignee = bead.assignee;
  if (bead.owner !== undefined) raw.owner = bead.owner;
  if (bead.due !== undefined) raw.due = bead.due;
  if (bead.estimate !== undefined) raw.estimated_minutes = bead.estimate;
  if (bead.closed !== undefined) raw.closed_at = bead.closed;
  if (bead.metadata !== undefined) raw.metadata = bead.metadata;

  return raw;
}
