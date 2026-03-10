/**
 * JSONL DTO translation helpers for the BeadsBackend.
 *
 * Converts between the JSONL on-disk format (snake_case, bd-specific
 * field names) and the domain Beat type used internally by foolery.
 */

import type { Beat, BeatPriority, Invariant, InvariantKind } from "@/lib/types";
import {
  builtinProfileDescriptor,
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
  aliases?: string[];
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

// ── Invariant encoding in notes ─────────────────────────────────

const INVARIANTS_HEADER = "[Invariants]";
const INVARIANT_LINE_RE = /^(Scope|State):\s*(.+)$/;

function parseInvariantsFromNotes(notes: string | undefined): { invariants: Invariant[]; cleanNotes: string | undefined } {
  if (!notes) return { invariants: [], cleanNotes: notes };
  const headerIdx = notes.indexOf(INVARIANTS_HEADER);
  if (headerIdx === -1) return { invariants: [], cleanNotes: notes };

  const before = notes.slice(0, headerIdx).trimEnd();
  const afterHeader = notes.slice(headerIdx + INVARIANTS_HEADER.length);
  const lines = afterHeader.split("\n");
  const invariants: Invariant[] = [];
  let endIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) { endIdx = i + 1; continue; }
    const match = INVARIANT_LINE_RE.exec(line);
    if (match) {
      const condition = match[2]?.trim();
      if (condition) {
        invariants.push({ kind: match[1] as InvariantKind, condition });
      }
      endIdx = i + 1;
    } else {
      break;
    }
  }

  if (invariants.length === 0) {
    // If no valid invariant lines were parsed, treat header text as normal notes.
    return { invariants: [], cleanNotes: notes };
  }

  const remaining = lines.slice(endIdx).join("\n").trim();
  const cleanNotes = [before, remaining].filter(Boolean).join("\n\n") || undefined;
  return { invariants, cleanNotes };
}

function embedInvariantsInNotes(notes: string | undefined, invariants: Invariant[] | undefined): string | undefined {
  if (!invariants?.length) return notes;
  const normalized = invariants
    .map((inv) => ({ kind: inv.kind, condition: inv.condition.trim() }))
    .filter((inv) => inv.condition.length > 0);
  if (normalized.length === 0) return notes;
  const section = [
    INVARIANTS_HEADER,
    ...normalized.map((inv) => `${inv.kind}: ${inv.condition}`),
  ].join("\n");
  return notes ? `${notes}\n\n${section}` : section;
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
  const workflow = builtinProfileDescriptor(profileId);
  const rawWorkflowState = deriveBeadsWorkflowState(status, labels, raw.metadata);
  const workflowState = rawWorkflowState;
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

  const { invariants, cleanNotes } = parseInvariantsFromNotes(raw.notes);

  return {
    id,
    aliases: raw.aliases?.filter((alias) => typeof alias === "string" && alias.trim().length > 0),
    title: raw.title,
    description: raw.description,
    notes: cleanNotes,
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
    invariants: invariants.length > 0 ? invariants : undefined,
    metadata,
  };
}

// ── Denormalize: Domain → JSONL ─────────────────────────────────

export function denormalizeToJsonl(beat: Beat): RawBead {
  const workflow = builtinProfileDescriptor(beat.profileId ?? beat.workflowId);
  const beatState = beat.state || workflow.initialState;
  const status = mapWorkflowStateToCompatStatus(beatState, "beads-jsonl-dto:denormalize");
  const labels = withWorkflowProfileLabel(
    withWorkflowStateLabel(beat.labels ?? [], beatState),
    workflow.id,
  );
  const raw: RawBead = {
    id: beat.id,
    aliases: beat.aliases,
    title: beat.title,
    status,
    priority: beat.priority,
    issue_type: beat.type,
    labels,
    created_at: beat.created,
    updated_at: beat.updated,
  };

  if (beat.description !== undefined) raw.description = beat.description;
  const notesWithInvariants = embedInvariantsInNotes(beat.notes, beat.invariants);
  if (notesWithInvariants !== undefined) raw.notes = notesWithInvariants;
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
