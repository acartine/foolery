/**
 * JSONL DTO translation helpers for the BeadsBackend.
 *
 * Converts between the JSONL on-disk format (snake_case, bd-specific
 * field names) and the domain Beat type used internally by foolery.
 */

import type { Beat, BeatPriority } from "@/lib/types";
import {
  beadsProfileDescriptor,
  deriveBeadsProfileId,
  deriveBeadsWorkflowState,
  deriveWorkflowRuntimeState,
  mapWorkflowStateToCompatStatus,
  withWorkflowStateLabel,
  withWorkflowProfileLabel,
} from "@/lib/workflows";

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

export function normalizeFromJsonl(raw: RawBead): Beat {
  const id = raw.id;
  const rawType = (raw.issue_type ?? raw.type ?? "task") as string;
  const type: string = VALID_TYPES.has(rawType) ? rawType : "task";
  const rawStatus = raw.status ?? "open";
  const status = VALID_STATUSES.has(rawStatus as string) ? rawStatus : "open";
  const labels = (raw.labels ?? []).filter((l) => l.trim() !== "");
  const profileId = deriveBeadsProfileId(labels, raw.metadata);
  const workflow = beadsProfileDescriptor(profileId);
  const workflowState = deriveBeadsWorkflowState(status, labels, workflow);
  const runtime = deriveWorkflowRuntimeState(workflow, workflowState);
  const rawPriority = raw.priority ?? 2;
  const priority = (typeof rawPriority === "number" && rawPriority >= 0 && rawPriority <= 4
    ? rawPriority
    : 2) as BeatPriority;

  // Merge close_reason from top-level JSONL field into metadata
  const baseMetadata = raw.metadata ?? {};
  const closeReason = raw.close_reason;
  const metadata = closeReason
    ? { ...baseMetadata, close_reason: closeReason }
    : Object.keys(baseMetadata).length > 0
      ? baseMetadata
      : undefined;

  return {
    id,
    title: raw.title,
    description: raw.description,
    notes: raw.notes,
    acceptance: raw.acceptance_criteria ?? (raw as Record<string, unknown>).acceptance as string | undefined,
    type,
    state: runtime.state,
    workflowId: workflow.id,
    workflowMode: workflow.mode,
    profileId: workflow.id,
    nextActionState: runtime.nextActionState,
    nextActionOwnerKind: runtime.nextActionOwnerKind,
    requiresHumanAction: runtime.requiresHumanAction,
    isAgentClaimable: runtime.isAgentClaimable,
    priority,
    labels,
    assignee: raw.assignee,
    owner: raw.owner,
    parent: inferParent(id, raw.parent),
    due: raw.due,
    estimate: raw.estimated_minutes ?? (raw as Record<string, unknown>).estimate as number | undefined,
    created: (raw.created_at ?? (raw as Record<string, unknown>).created ?? new Date().toISOString()) as string,
    updated: (raw.updated_at ?? (raw as Record<string, unknown>).updated ?? new Date().toISOString()) as string,
    closed: raw.closed_at ?? (raw as Record<string, unknown>).closed as string | undefined,
    metadata,
  };
}

// ── Denormalize: Domain → JSONL ─────────────────────────────────

export function denormalizeToJsonl(beat: Beat): RawBead {
  const workflow = beadsProfileDescriptor(beat.profileId ?? beat.workflowId);
  const beatState = beat.state || workflow.initialState;
  const status = mapWorkflowStateToCompatStatus(beatState, "beads-jsonl-dto:denormalize");
  const labels = withWorkflowProfileLabel(
    withWorkflowStateLabel(beat.labels ?? [], beatState),
    workflow.id,
  );
  const raw: RawBead = {
    id: beat.id,
    title: beat.title,
    status,
    priority: beat.priority,
    issue_type: beat.type,
    labels,
    created_at: beat.created,
    updated_at: beat.updated,
  };

  if (beat.description !== undefined) raw.description = beat.description;
  if (beat.notes !== undefined) raw.notes = beat.notes;
  if (beat.acceptance !== undefined) raw.acceptance_criteria = beat.acceptance;
  if (beat.assignee !== undefined) raw.assignee = beat.assignee;
  if (beat.owner !== undefined) raw.owner = beat.owner;
  if (beat.parent !== undefined) raw.parent = beat.parent;
  if (beat.due !== undefined) raw.due = beat.due;
  if (beat.estimate !== undefined) raw.estimated_minutes = beat.estimate;
  if (beat.closed !== undefined) raw.closed_at = beat.closed;
  if (beat.metadata?.close_reason !== undefined) {
    raw.close_reason = beat.metadata.close_reason as string;
  }
  if (beat.metadata !== undefined) raw.metadata = beat.metadata;

  return raw;
}
