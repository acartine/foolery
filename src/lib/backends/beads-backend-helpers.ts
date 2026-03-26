/**
 * Internal helper functions for BeadsBackend.
 *
 * Extracted to keep beads-backend.ts under 500 lines.
 */

import type { Beat, Invariant } from "@/lib/types";
import type { BeatListFilters, UpdateBeatInput } from "@/lib/backend-port";
import { includeActiveAncestors } from "@/lib/active-ancestor-filter";
import {
  builtinProfileDescriptor,
  builtinWorkflowDescriptors,
  deriveWorkflowRuntimeState,
  normalizeStateForWorkflow,
  resolveStep,
  StepPhase,
  withWorkflowProfileLabel,
  withWorkflowStateLabel,
} from "@/lib/workflows";

// ── ID and utility helpers ──────────────────────────────────────

export function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `beads-${ts}-${rand}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function isSupportedProfileSelection(
  profileId: string | undefined,
): boolean {
  if (!profileId) return true;
  const normalized = profileId.trim().toLowerCase();
  if (!normalized) return true;
  if (
    normalized === "beads-coarse" ||
    normalized === "beads-coarse-human-gated"
  ) {
    return true;
  }
  return builtinWorkflowDescriptors().some(
    (workflow) => workflow.id === normalized,
  );
}

// ── Filter helpers ──────────────────────────────────────────────

export function applyFilters(
  beats: Beat[],
  filters?: BeatListFilters,
): Beat[] {
  if (!filters) return beats;

  const isQueuedPhaseFilter = filters.state === "queued";
  const isActivePhaseFilter = filters.state === "in_action";

  const filtered = beats.filter((b) => {
    if (!matchesBeatFilter(b, filters)) return false;
    return true;
  });

  if (isQueuedPhaseFilter) {
    const withDescendants = includeDescendantsOfQueueParents(
      beats, filtered,
    );
    return includeActiveAncestors(beats, withDescendants);
  }
  if (isActivePhaseFilter) {
    return includeActiveAncestors(beats, filtered);
  }

  return filtered;
}

function matchesBeatFilter(b: Beat, filters: BeatListFilters): boolean {
  if (filters.workflowId && b.workflowId !== filters.workflowId) {
    return false;
  }
  if (filters.state) {
    if (filters.state === "queued") {
      if (resolveStep(b.state)?.phase !== StepPhase.Queued) return false;
    } else if (filters.state === "in_action") {
      if (resolveStep(b.state)?.phase !== StepPhase.Active) return false;
    } else {
      if (b.state !== filters.state) return false;
    }
  }
  if (filters.profileId && b.profileId !== filters.profileId) return false;
  if (filters.type && b.type !== filters.type) return false;
  if (
    filters.requiresHumanAction !== undefined &&
    (b.requiresHumanAction ?? false) !== filters.requiresHumanAction
  ) {
    return false;
  }
  if (filters.nextOwnerKind && b.nextActionOwnerKind !== filters.nextOwnerKind) {
    return false;
  }
  if (filters.priority !== undefined && b.priority !== filters.priority) {
    return false;
  }
  if (filters.assignee && b.assignee !== filters.assignee) return false;
  if (filters.label && !b.labels.includes(filters.label)) return false;
  if (filters.owner && b.owner !== filters.owner) return false;
  if (filters.parent && b.parent !== filters.parent) return false;
  return true;
}

/**
 * Include any beat whose ancestor (recursively) is in a queue state.
 */
function includeDescendantsOfQueueParents(
  allBeats: Beat[],
  filtered: Beat[],
): Beat[] {
  const filteredIds = new Set(filtered.map((b) => b.id));
  const byId = new Map(allBeats.map((b) => [b.id, b]));

  const queueParentIds = new Set<string>();
  for (const b of allBeats) {
    if (resolveStep(b.state)?.phase === StepPhase.Queued) {
      queueParentIds.add(b.id);
    }
  }
  if (queueParentIds.size === 0) return filtered;

  const ancestorCache = new Map<string, boolean>();
  function hasQueueAncestor(id: string): boolean {
    if (ancestorCache.has(id)) return ancestorCache.get(id)!;
    const beat = byId.get(id);
    if (!beat?.parent) {
      ancestorCache.set(id, false);
      return false;
    }
    if (queueParentIds.has(beat.parent)) {
      ancestorCache.set(id, true);
      return true;
    }
    const result = hasQueueAncestor(beat.parent);
    ancestorCache.set(id, result);
    return result;
  }

  const extras: Beat[] = [];
  for (const b of allBeats) {
    if (filteredIds.has(b.id)) continue;
    if (hasQueueAncestor(b.id)) extras.push(b);
  }

  return extras.length > 0 ? [...filtered, ...extras] : filtered;
}

// ── Invariant helpers ───────────────────────────────────────────

export function normalizeInvariants(
  invariants: readonly Invariant[] | undefined,
): Invariant[] | undefined {
  if (!invariants?.length) return undefined;
  const seen = new Set<string>();
  const normalized: Invariant[] = [];
  for (const inv of invariants) {
    const condition = inv.condition.trim();
    if (!condition) continue;
    const key = `${inv.kind}:${condition}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ kind: inv.kind, condition });
  }
  return normalized.length > 0 ? normalized : undefined;
}

// ── Update helpers ──────────────────────────────────────────────

export function applyUpdate(beat: Beat, input: UpdateBeatInput): void {
  if (input.title !== undefined) beat.title = input.title;
  if (input.description !== undefined) {
    beat.description = input.description;
  }
  if (input.type !== undefined) beat.type = input.type;

  const selectedProfileId =
    input.profileId ?? beat.profileId ?? beat.workflowId;
  const workflow = builtinProfileDescriptor(selectedProfileId);

  let nextState = beat.state
    ? normalizeStateForWorkflow(beat.state, workflow)
    : workflow.initialState;
  if (input.profileId !== undefined && input.state === undefined) {
    nextState = normalizeStateForWorkflow(beat.state, workflow);
  }
  if (input.state !== undefined) {
    nextState = normalizeStateForWorkflow(input.state, workflow);
  }

  const runtime = deriveWorkflowRuntimeState(workflow, nextState);
  beat.workflowId = workflow.id;
  beat.profileId = workflow.id;
  beat.workflowMode = workflow.mode;
  beat.state = runtime.state;
  beat.nextActionState = runtime.nextActionState;
  beat.nextActionOwnerKind = runtime.nextActionOwnerKind;
  beat.requiresHumanAction = runtime.requiresHumanAction;
  beat.isAgentClaimable = runtime.isAgentClaimable;

  applyScalarFields(beat, input);
  applyInvariantChanges(beat, input);

  beat.labels = withWorkflowProfileLabel(
    withWorkflowStateLabel(beat.labels ?? [], beat.state),
    workflow.id,
  );
}

function applyScalarFields(
  beat: Beat,
  input: UpdateBeatInput,
): void {
  if (input.priority !== undefined) beat.priority = input.priority;
  if (input.parent !== undefined) beat.parent = input.parent;
  if (input.labels !== undefined) {
    beat.labels = [...new Set([...beat.labels, ...input.labels])];
  }
  if (input.removeLabels !== undefined) {
    beat.labels = beat.labels.filter(
      (l) => !input.removeLabels!.includes(l),
    );
  }
  if (input.assignee !== undefined) beat.assignee = input.assignee;
  if (input.due !== undefined) beat.due = input.due;
  if (input.acceptance !== undefined) beat.acceptance = input.acceptance;
  if (input.notes !== undefined) beat.notes = input.notes;
  if (input.estimate !== undefined) beat.estimate = input.estimate;
}

function invariantKey(inv: Invariant): string {
  return `${inv.kind}:${inv.condition}`;
}

function applyInvariantChanges(
  beat: Beat,
  input: UpdateBeatInput,
): void {
  if (input.clearInvariants) {
    beat.invariants = undefined;
  }
  const removeInvariants = normalizeInvariants(input.removeInvariants);
  if (removeInvariants?.length) {
    const toRemove = new Set(removeInvariants.map(invariantKey));
    beat.invariants = (beat.invariants ?? []).filter(
      (inv) => !toRemove.has(invariantKey(inv)),
    );
    if (beat.invariants.length === 0) beat.invariants = undefined;
  }
  const addInvariants = normalizeInvariants(input.addInvariants);
  if (addInvariants?.length) {
    const existing = new Set(
      (beat.invariants ?? []).map(invariantKey),
    );
    const toAdd = addInvariants.filter(
      (inv) => !existing.has(invariantKey(inv)),
    );
    beat.invariants = [...(beat.invariants ?? []), ...toAdd];
  }
  beat.invariants = normalizeInvariants(beat.invariants);
}

// ── Query expression matcher ────────────────────────────────────

export function matchExpression(
  beat: Beat,
  expression: string,
): boolean {
  const terms = expression.split(/\s+/);
  return terms.every((term) => {
    const [field, value] = term.split(":");
    if (!field || !value) return true;
    return matchField(beat, field, value);
  });
}

function matchField(
  beat: Beat,
  field: string,
  value: string,
): boolean {
  switch (field) {
    case "status":
    case "workflowstate":
    case "state":
      return beat.state === value;
    case "workflow":
    case "workflowid":
      return beat.workflowId === value;
    case "profile":
    case "profileid":
      return beat.profileId === value;
    case "requireshumanaction":
    case "human":
      return String(Boolean(beat.requiresHumanAction)) === value;
    case "nextowner":
    case "nextownerkind":
      return beat.nextActionOwnerKind === value;
    case "type":
      return beat.type === value;
    case "priority":
      return String(beat.priority) === value;
    case "assignee":
      return beat.assignee === value;
    case "label":
      return beat.labels.includes(value);
    case "owner":
      return beat.owner === value;
    case "parent":
      return beat.parent === value;
    default:
      return true;
  }
}
