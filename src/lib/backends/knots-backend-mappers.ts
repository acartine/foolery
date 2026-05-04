/**
 * Beat mapping and filtering logic for KnotsBackend.  Extracted from
 * knots-backend.ts to stay within the 500-line file limit.
 */

import type { BeatListFilters } from "@/lib/backend-port";
import { includeActiveAncestors } from "@/lib/active-ancestor-filter";
import type {
  Beat,
  Invariant,
  MemoryWorkflowDescriptor,
} from "@/lib/types";
import type { KnotEdge, KnotRecord } from "@/lib/knots";
import {
  deriveWorkflowRuntimeState,
  normalizeStateForWorkflow,
} from "@/lib/workflows";
import { isPlanBeat } from "@/lib/orchestration-plan-payload";

import {
  normalizePriority,
  normalizeInvariants,
  extractAcceptanceFromNotes,
  stringifyNotes,
  knotStepEntries,
  deriveParentId,
  normalizeProfileId,
  collectAliases,
} from "@/lib/backends/knots-backend-helpers";

type KnotLeaseAgentInfo = {
  agent_type?: string;
  provider?: string;
  agent_name?: string;
  model?: string;
  model_version?: string;
};

// ── toBeat ──────────────────────────────────────────────────────────

export function toBeat(
  knot: KnotRecord,
  edges: KnotEdge[],
  knownIds: ReadonlySet<string>,
  aliasToId: ReadonlyMap<string, string>,
  workflowsById: Map<string, MemoryWorkflowDescriptor>,
): Beat {
  const fallback = workflowsById.values().next()
    .value as MemoryWorkflowDescriptor | undefined;
  const profileId =
    normalizeProfileId(knot.profile_id ?? knot.workflow_id) ??
    fallback?.id ??
    "autopilot";
  const workflow = workflowsById.get(profileId) ?? fallback;
  const stepEntries = knotStepEntries(knot);
  const invariants = normalizeInvariants(knot.invariants);
  const aliases = collectAliases(knot);

  const nativeAcceptance =
    typeof knot.acceptance === "string"
      ? knot.acceptance.trim() || undefined
      : undefined;
  const acceptance =
    nativeAcceptance ?? extractAcceptanceFromNotes(knot.notes);

  if (!workflow) {
    return toBeatWithoutWorkflow(
      knot,
      edges,
      knownIds,
      aliasToId,
      profileId,
      stepEntries,
      invariants,
      aliases,
      acceptance,
    );
  }

  return toBeatWithWorkflow(
    knot,
    edges,
    knownIds,
    aliasToId,
    workflow,
    stepEntries,
    invariants,
    aliases,
    acceptance,
  );
}

function toBeatWithoutWorkflow(
  knot: KnotRecord,
  edges: KnotEdge[],
  knownIds: ReadonlySet<string>,
  aliasToId: ReadonlyMap<string, string>,
  profileId: string,
  stepEntries: Array<Record<string, unknown>>,
  invariants: Invariant[],
  aliases: string[],
  acceptance: string | undefined,
): Beat {
  const tags = (knot.tags ?? []).filter(
    (tag) => typeof tag === "string" && tag.trim().length > 0
  );
  const leaseAgentInfo = knotLeaseAgentInfo(knot);
  return {
    id: knot.id,
    title: knot.title,
    description:
      typeof knot.description === "string"
        ? knot.description
        : knot.body ?? undefined,
    type: knot.type ?? "work",
    state: knot.state,
    workflowId: profileId,
    workflowMode: "granular_autonomous",
    profileId,
    nextActionOwnerKind: "none",
    requiresHumanAction: false,
    isAgentClaimable: false,
    priority: normalizePriority(knot.priority),
    labels: tags,
    aliases: aliases.length > 0 ? aliases : undefined,
    notes: stringifyNotes(knot.notes),
    acceptance,
    parent: deriveParentId(
      knot.id,
      aliases[0] ?? null,
      edges,
      knownIds,
      aliasToId,
    ),
    created: knot.created_at ?? knot.updated_at,
    updated: knot.updated_at,
    invariants: invariants.length > 0 ? invariants : undefined,
    metadata: {
      knotsProfileId: profileId,
      knotsSteps: stepEntries,
      // For Lease-type knots, the agent identity lives on the
      // knot's own `lease.agent_info` (no step / note / capsule
      // exists on a fresh lease). Surfacing it here lets the
      // beat-table renderer show the lease's agent without
      // re-extracting from anywhere — read what Knots stamped.
      ...(leaseAgentInfo
        ? { knotsLeaseAgentInfo: leaseAgentInfo }
        : {}),
    },
  };
}

function toBeatWithWorkflow(
  knot: KnotRecord,
  edges: KnotEdge[],
  knownIds: ReadonlySet<string>,
  aliasToId: ReadonlyMap<string, string>,
  workflow: MemoryWorkflowDescriptor,
  stepEntries: Array<Record<string, unknown>>,
  invariants: Invariant[],
  aliases: string[],
  acceptance: string | undefined,
): Beat {
  const tags = (knot.tags ?? []).filter(
    (tag) => typeof tag === "string" && tag.trim().length > 0
  );
  const leaseAgentInfo = knotLeaseAgentInfo(knot);
  const rawWorkflowState = normalizeStateForWorkflow(
    knot.state,
    workflow,
  );
  const runtime = deriveWorkflowRuntimeState(
    workflow,
    rawWorkflowState,
  );
  const notes = stringifyNotes(knot.notes);
  return {
    id: knot.id,
    title: knot.title,
    description:
      typeof knot.description === "string"
        ? knot.description
        : typeof knot.body === "string"
          ? knot.body
          : undefined,
    type: knot.type ?? "work",
    state: runtime.state,
    workflowId: workflow.id,
    workflowMode: workflow.mode,
    profileId: workflow.id,
    nextActionState: runtime.nextActionState,
    nextActionOwnerKind: runtime.nextActionOwnerKind,
    requiresHumanAction: runtime.requiresHumanAction,
    isAgentClaimable: runtime.isAgentClaimable,
    priority: normalizePriority(knot.priority),
    labels: tags,
    aliases: aliases.length > 0 ? aliases : undefined,
    notes,
    acceptance,
    parent: deriveParentId(
      knot.id,
      aliases[0] ?? null,
      edges,
      knownIds,
      aliasToId,
    ),
    created: knot.created_at ?? knot.updated_at,
    updated: knot.updated_at,
    closed: workflow.terminalStates.includes(runtime.state)
      ? knot.updated_at
      : undefined,
    invariants: invariants.length > 0 ? invariants : undefined,
    metadata: {
      knotsProfileId: workflow.id,
      knotsState: knot.state,
      knotsProfileEtag: knot.profile_etag,
      knotsWorkflowEtag: knot.workflow_etag,
      knotsHandoffCapsules: knot.handoff_capsules ?? [],
      knotsNotes: knot.notes ?? [],
      knotsSteps: stepEntries,
      // Surfaced for any knot with a bound lease so the table can
      // render the lease's agent without re-extracting. See above.
      ...(leaseAgentInfo
        ? { knotsLeaseAgentInfo: leaseAgentInfo }
        : {}),
    },
  };
}

function knotLeaseAgentInfo(
  knot: KnotRecord,
): KnotLeaseAgentInfo | undefined {
  return cleanLeaseAgentInfo(knot.lease?.agent_info)
    ?? cleanLeaseAgentInfo(
      (knot as KnotRecord & { lease_agent?: unknown }).lease_agent,
    );
}

function cleanLeaseAgentInfo(
  value: unknown,
): KnotLeaseAgentInfo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const info: KnotLeaseAgentInfo = {};
  copyAgentField(info, record, "agent_type");
  copyAgentField(info, record, "provider");
  copyAgentField(info, record, "agent_name");
  copyAgentField(info, record, "model");
  copyAgentField(info, record, "model_version");
  return Object.keys(info).length > 0 ? info : undefined;
}

function copyAgentField(
  info: KnotLeaseAgentInfo,
  record: Record<string, unknown>,
  key: keyof KnotLeaseAgentInfo,
): void {
  const value = record[key];
  if (typeof value === "string" && value.trim().length > 0) {
    info[key] = value.trim();
  }
}

// ── Filtering ───────────────────────────────────────────────────────

export function applyFilters(
  beats: Beat[],
  filters?: BeatListFilters,
): Beat[] {
  // Plan knots show only in the setlist; hide from beat-list paths.
  beats = beats.filter((b) => !isPlanBeat(b));
  if (!filters) return beats;

  const isQueuedPhaseFilter = filters.state === "queued";
  const isActivePhaseFilter = filters.state === "in_action";
  const isExactQueueStateFilter =
    typeof filters.state === "string" &&
    filters.state !== "queued" &&
    filters.state !== "in_action" &&
    beats.some(
      (beat) =>
        beat.state === filters.state &&
        isQueuedBeat(beat)
    );
  const hidesLeaseType =
    filters.state === "queued" ||
    isExactQueueStateFilter;
  const visibleBeats = hidesLeaseType
    ? beats.filter((beat) => beat.type !== "lease")
    : beats;

  const filtered = visibleBeats.filter((b) => {
    if (
      filters.workflowId &&
      b.workflowId !== filters.workflowId
    )
      return false;
    if (filters.state) {
      if (filters.state === "queued") {
        if (!isQueuedBeat(b)) return false;
      } else if (filters.state === "in_action") {
        if (!isActiveBeat(b)) return false;
      } else {
        if (b.state !== filters.state) return false;
      }
    }
    if (
      filters.profileId &&
      b.profileId !== filters.profileId
    )
      return false;
    if (
      filters.requiresHumanAction !== undefined &&
      (b.requiresHumanAction ?? false) !==
        filters.requiresHumanAction
    ) {
      return false;
    }
    if (
      filters.nextOwnerKind &&
      b.nextActionOwnerKind !== filters.nextOwnerKind
    )
      return false;
    if (filters.type && b.type !== filters.type) return false;
    if (
      filters.priority !== undefined &&
      b.priority !== filters.priority
    )
      return false;
    if (filters.assignee && b.assignee !== filters.assignee)
      return false;
    if (filters.label && !b.labels.includes(filters.label))
      return false;
    if (filters.owner && b.owner !== filters.owner) return false;
    if (filters.parent && b.parent !== filters.parent) return false;
    return true;
  });

  if (isQueuedPhaseFilter) {
    const withDescendants = includeDescendantsOfQueueParents(
      visibleBeats,
      filtered,
    );
    return includeActiveAncestors(visibleBeats, withDescendants);
  }
  if (isActivePhaseFilter) {
    return includeActiveAncestors(visibleBeats, filtered);
  }

  return filtered;
}

function includeDescendantsOfQueueParents(
  allBeats: Beat[],
  filtered: Beat[],
): Beat[] {
  const filteredIds = new Set(filtered.map((b) => b.id));
  const byId = new Map(allBeats.map((b) => [b.id, b]));

  const queueParentIds = new Set<string>();
  for (const b of allBeats) {
    if (isQueuedBeat(b)) {
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

export function matchExpression(
  beat: Beat,
  expression: string,
): boolean {
  const terms = expression.split(/\s+/).filter(Boolean);
  return terms.every((term) => {
    const [field, value] = term.split(":");
    if (!field || !value) return true;
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
      case "nextowner":
      case "nextownerkind":
        return beat.nextActionOwnerKind === value;
      case "human":
      case "requireshumanaction":
        return String(Boolean(beat.requiresHumanAction)) === value;
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
      case "id":
        return beat.id === value;
      default:
        return true;
    }
  });
}

export function memoryManagerKey(repoPath?: string): string {
  return repoPath ?? process.cwd();
}

function isQueuedBeat(beat: Beat): boolean {
  return (
    typeof beat.nextActionState === "string" &&
    beat.nextActionState !== beat.state
  );
}

function isActiveBeat(beat: Beat): boolean {
  return (
    typeof beat.nextActionState === "string" &&
    beat.nextActionState === beat.state
  );
}
