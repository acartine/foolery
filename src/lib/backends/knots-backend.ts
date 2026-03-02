/**
 * KnotsBackend -- BackendPort adapter backed by the `kno` CLI.
 *
 * Uses Knots as the source of truth and maps profile/state ownership into
 * Foolery's backend contract.
 */

import type {
  BackendPort,
  BackendResult,
  BeatListFilters,
  BeatQueryOptions,
  PollPromptOptions,
  PollPromptResult,
  TakePromptOptions,
  TakePromptResult,
} from "@/lib/backend-port";
import type { BackendCapabilities } from "@/lib/backend-capabilities";
import type { BackendErrorCode } from "@/lib/backend-errors";
import { isRetryableByDefault } from "@/lib/backend-errors";
import type { CreateBeatInput, UpdateBeatInput } from "@/lib/schemas";
import type {
  Beat,
  BeatDependency,
  MemoryWorkflowDescriptor,
  MemoryWorkflowOwners,
  WorkflowMode,
} from "@/lib/types";
import type {
  KnotEdge,
  KnotProfileDefinition,
  KnotRecord,
  KnotUpdateInput,
} from "@/lib/knots";
import * as knots from "@/lib/knots";
import {
  deriveWorkflowRuntimeState,
  inferWorkflowMode,
  mapStatusToDefaultWorkflowState,
  normalizeStateForWorkflow,
  resolveStep,
  StepPhase,
} from "@/lib/workflows";

const EDGE_CACHE_TTL_MS = 2_000;
const WORKFLOW_CACHE_TTL_MS = 10_000;

export const KNOTS_CAPABILITIES: Readonly<BackendCapabilities> = Object.freeze({
  canCreate: true,
  canUpdate: true,
  canDelete: false,
  canClose: true,
  canSearch: true,
  canQuery: true,
  canListReady: true,
  canManageDependencies: true,
  canManageLabels: true,
  canSync: true,
  maxConcurrency: 1,
});

interface CachedEdges {
  edges: KnotEdge[];
  expiresAt: number;
}

interface CachedWorkflows {
  workflows: MemoryWorkflowDescriptor[];
  expiresAt: number;
}

function ok<T>(data: T): BackendResult<T> {
  return { ok: true, data };
}

function backendError(code: BackendErrorCode, message: string): BackendResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: isRetryableByDefault(code),
    },
  };
}

function propagateError<T>(result: BackendResult<unknown>): BackendResult<T> {
  return { ok: false, error: result.error };
}

function classifyKnotsError(message: string): BackendErrorCode {
  const lower = message.toLowerCase();

  if (
    lower.includes("not found") ||
    lower.includes("no such") ||
    lower.includes("local cache")
  ) {
    return "NOT_FOUND";
  }
  if (lower.includes("already exists") || lower.includes("duplicate")) {
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
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "TIMEOUT";
  }
  if (lower.includes("locked") || lower.includes("lock") || lower.includes("busy")) {
    return "LOCKED";
  }
  if (lower.includes("permission denied") || lower.includes("unauthorized")) {
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

function fromKnots<T>(result: { ok: boolean; data?: T; error?: string }): BackendResult<T> {
  if (result.ok) return { ok: true, data: result.data };
  const message = result.error ?? "Unknown knots error";
  const code = classifyKnotsError(message);
  return {
    ok: false,
    error: { code, message, retryable: isRetryableByDefault(code) },
  };
}

function normalizePriority(raw: number | null | undefined): 0 | 1 | 2 | 3 | 4 {
  if (raw === 0 || raw === 1 || raw === 2 || raw === 3 || raw === 4) return raw;
  return 2;
}

function stringifyNotes(raw: unknown): string | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const parts = raw
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [] as string[];
      const record = entry as Record<string, unknown>;
      const content = typeof record.content === "string" ? record.content.trim() : "";
      if (!content) return [] as string[];

      const username = typeof record.username === "string" ? record.username : "unknown";
      const datetime = typeof record.datetime === "string" ? record.datetime : "";
      const prefix = datetime ? `[${datetime}] ${username}` : username;
      return [`${prefix}: ${content}`];
    })
    .filter((value) => value.length > 0);

  if (parts.length === 0) return undefined;
  return parts.join("\n\n");
}

function parentFromEdges(id: string, edges: KnotEdge[]): string | undefined {
  const parentEdge = edges.find((edge) => edge.kind === "parent_of" && edge.dst === id);
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

function deriveParentId(
  id: string,
  edges: KnotEdge[],
  knownIds: ReadonlySet<string>,
): string | undefined {
  return parentFromEdges(id, edges) ?? parentFromHierarchicalId(id, knownIds);
}

function isBlockedByEdges(id: string, edges: KnotEdge[]): boolean {
  return edges.some((edge) => edge.kind === "blocked_by" && edge.src === id);
}

function normalizeOwners(profile: KnotProfileDefinition): MemoryWorkflowOwners {
  return {
    planning: profile.owners.planning.kind,
    plan_review: profile.owners.plan_review.kind,
    implementation: profile.owners.implementation.kind,
    implementation_review: profile.owners.implementation_review.kind,
    shipment: profile.owners.shipment.kind,
    shipment_review: profile.owners.shipment_review.kind,
  };
}

function modeFromOwners(owners: MemoryWorkflowOwners, profile: KnotProfileDefinition): WorkflowMode {
  const hasHuman = Object.values(owners).some((kind) => kind === "human");
  if (hasHuman) return "coarse_human_gated";
  return inferWorkflowMode(profile.id, profile.description, profile.states);
}

function toDescriptor(profile: KnotProfileDefinition): MemoryWorkflowDescriptor {
  const states = profile.states.map((state) => state.trim().toLowerCase());
  const owners = normalizeOwners(profile);
  const queueStates = states.filter((s) => resolveStep(s)?.phase === StepPhase.Queued);
  const actionStates = states.filter((s) => resolveStep(s)?.phase === StepPhase.Active);
  const reviewQueueStates = queueStates.filter((state) => {
    const resolved = resolveStep(state);
    return resolved ? resolved.step.endsWith("_review") : false;
  });
  const humanQueueStates = queueStates.filter((queueState) => {
    const resolved = resolveStep(queueState);
    if (!resolved) return false;
    return owners[resolved.step] === "human";
  });
  const mode = modeFromOwners(owners, profile);

  return {
    id: profile.id,
    profileId: profile.id,
    backingWorkflowId: profile.id,
    label: `Knots (${profile.id})`,
    mode,
    initialState: profile.initial_state.trim().toLowerCase(),
    states,
    terminalStates: profile.terminal_states.map((state) => state.trim().toLowerCase()),
    transitions: profile.transitions?.map((transition) => ({
      from: transition.from.trim().toLowerCase(),
      to: transition.to.trim().toLowerCase(),
    })),
    finalCutState: humanQueueStates[0] ?? null,
    retakeState: states.includes("ready_for_implementation") ? "ready_for_implementation" : profile.initial_state,
    promptProfileId: profile.id,
    owners,
    queueStates,
    actionStates,
    reviewQueueStates,
    humanQueueStates,
  };
}

function mapForProfiles(profiles: KnotProfileDefinition[]): MemoryWorkflowDescriptor[] {
  const descriptors = profiles.map(toDescriptor);
  const deduped = new Map<string, MemoryWorkflowDescriptor>();
  for (const descriptor of descriptors) {
    deduped.set(descriptor.id, descriptor);
  }
  return Array.from(deduped.values());
}

function normalizeProfileId(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function toBeat(
  knot: KnotRecord,
  edges: KnotEdge[],
  knownIds: ReadonlySet<string>,
  workflowsById: Map<string, MemoryWorkflowDescriptor>,
): Beat {
  const fallback = workflowsById.values().next().value as MemoryWorkflowDescriptor | undefined;
  const profileId = normalizeProfileId(knot.profile_id ?? knot.workflow_id) ?? fallback?.id ?? "autopilot";
  const workflow = workflowsById.get(profileId) ?? fallback;

  if (!workflow) {
    return {
      id: knot.id,
      title: knot.title,
      description: typeof knot.description === "string" ? knot.description : knot.body ?? undefined,
      type: knot.type ?? "work",
      state: knot.state,
      workflowId: profileId,
      workflowMode: "granular_autonomous",
      profileId,
      nextActionOwnerKind: "none",
      requiresHumanAction: false,
      isAgentClaimable: false,
      priority: normalizePriority(knot.priority),
      labels: (knot.tags ?? []).filter((tag) => typeof tag === "string" && tag.trim().length > 0),
      notes: stringifyNotes(knot.notes),
      parent: deriveParentId(knot.id, edges, knownIds),
      created: knot.created_at ?? knot.updated_at,
      updated: knot.updated_at,
      metadata: {
        knotsProfileId: profileId,
      },
    };
  }

  const workflowState = normalizeStateForWorkflow(knot.state, workflow);
  const runtime = deriveWorkflowRuntimeState(workflow, workflowState);
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
    labels: (knot.tags ?? []).filter((tag) => typeof tag === "string" && tag.trim().length > 0),
    notes,
    parent: deriveParentId(knot.id, edges, knownIds),
    created: knot.created_at ?? knot.updated_at,
    updated: knot.updated_at,
    closed: workflow.terminalStates.includes(runtime.state) ? knot.updated_at : undefined,
    metadata: {
      knotsProfileId: profileId,
      knotsState: knot.state,
      knotsProfileEtag: knot.profile_etag,
      knotsWorkflowEtag: knot.workflow_etag,
      knotsHandoffCapsules: knot.handoff_capsules ?? [],
      knotsNotes: knot.notes ?? [],
    },
  };
}

function applyFilters(beats: Beat[], filters?: BeatListFilters): Beat[] {
  if (!filters) return beats;
  return beats.filter((b) => {
    if (filters.workflowId && b.workflowId !== filters.workflowId) return false;
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
    if (filters.requiresHumanAction !== undefined && (b.requiresHumanAction ?? false) !== filters.requiresHumanAction) {
      return false;
    }
    if (filters.nextOwnerKind && b.nextActionOwnerKind !== filters.nextOwnerKind) return false;
    if (filters.type && b.type !== filters.type) return false;
    if (filters.priority !== undefined && b.priority !== filters.priority) return false;
    if (filters.assignee && b.assignee !== filters.assignee) return false;
    if (filters.label && !b.labels.includes(filters.label)) return false;
    if (filters.owner && b.owner !== filters.owner) return false;
    if (filters.parent && b.parent !== filters.parent) return false;
    return true;
  });
}

function matchExpression(beat: Beat, expression: string): boolean {
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

function memoryManagerKey(repoPath?: string): string {
  return repoPath ?? process.cwd();
}

export class KnotsBackend implements BackendPort {
  readonly capabilities: BackendCapabilities = KNOTS_CAPABILITIES;

  private defaultRepoPath: string;
  private edgeCache = new Map<string, CachedEdges>();
  private workflowCache = new Map<string, CachedWorkflows>();

  constructor(repoPath?: string) {
    this.defaultRepoPath = repoPath ?? process.cwd();
  }

  private resolvePath(repoPath?: string): string {
    return repoPath ?? this.defaultRepoPath;
  }

  private workflowCacheKey(repoPath: string): string {
    return memoryManagerKey(repoPath);
  }

  private async getWorkflowDescriptorsForRepo(
    repoPath: string,
  ): Promise<BackendResult<MemoryWorkflowDescriptor[]>> {
    const key = this.workflowCacheKey(repoPath);
    const cached = this.workflowCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return ok(cached.workflows);
    }

    const rawProfiles = fromKnots(await knots.listProfiles(repoPath));
    if (!rawProfiles.ok) return propagateError<MemoryWorkflowDescriptor[]>(rawProfiles);

    const normalized = mapForProfiles(rawProfiles.data ?? []);
    if (normalized.length === 0) {
      return backendError("INVALID_INPUT", "No profiles available in knots backend");
    }

    this.workflowCache.set(key, {
      workflows: normalized,
      expiresAt: Date.now() + WORKFLOW_CACHE_TTL_MS,
    });
    return ok(normalized);
  }

  private async workflowMapByProfileId(
    repoPath: string,
  ): Promise<BackendResult<Map<string, MemoryWorkflowDescriptor>>> {
    const workflowsResult = await this.getWorkflowDescriptorsForRepo(repoPath);
    if (!workflowsResult.ok) return propagateError<Map<string, MemoryWorkflowDescriptor>>(workflowsResult);

    const map = new Map<string, MemoryWorkflowDescriptor>();
    for (const workflow of workflowsResult.data ?? []) {
      map.set(workflow.id, workflow);
      map.set(workflow.backingWorkflowId, workflow);
    }
    return ok(map);
  }

  private edgeCacheKey(id: string, repoPath: string): string {
    return `${memoryManagerKey(repoPath)}::${id}`;
  }

  private invalidateEdgeCache(repoPath: string, id?: string): void {
    if (!id) {
      const prefix = `${memoryManagerKey(repoPath)}::`;
      for (const key of this.edgeCache.keys()) {
        if (key.startsWith(prefix)) this.edgeCache.delete(key);
      }
      return;
    }
    this.edgeCache.delete(this.edgeCacheKey(id, repoPath));
  }

  private async getEdgesForId(id: string, repoPath: string): Promise<BackendResult<KnotEdge[]>> {
    const key = this.edgeCacheKey(id, repoPath);
    const cached = this.edgeCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return ok(cached.edges);
    }

    const edgesResult = fromKnots(await knots.listEdges(id, "both", repoPath));
    if (!edgesResult.ok) return propagateError<KnotEdge[]>(edgesResult);

    const edges = edgesResult.data ?? [];
    this.edgeCache.set(key, {
      edges,
      expiresAt: Date.now() + EDGE_CACHE_TTL_MS,
    });
    return ok(edges);
  }

  private async buildBeatsForRepo(repoPath: string): Promise<BackendResult<Beat[]>> {
    const workflowMapResult = await this.workflowMapByProfileId(repoPath);
    if (!workflowMapResult.ok) return propagateError<Beat[]>(workflowMapResult);
    const workflowMap = workflowMapResult.data ?? new Map<string, MemoryWorkflowDescriptor>();

    const listResult = fromKnots(await knots.listKnots(repoPath));
    if (!listResult.ok) return propagateError<Beat[]>(listResult);

    const records = listResult.data ?? [];
    const knownIds = new Set(records.map((record) => record.id));

    // Fetch edges sequentially to avoid CLI lock contention.
    // Cached entries are returned instantly; only uncached IDs hit the CLI.
    const edgesById = new Map<string, KnotEdge[]>();
    for (const record of records) {
      const edgeResult = await this.getEdgesForId(record.id, repoPath);
      if (!edgeResult.ok) {
        // Keep list/search resilient when edge lookups are transiently unavailable.
        // Hierarchy can still be inferred from dotted IDs, and detail/dependency paths
        // continue to fetch precise edges on demand.
        edgesById.set(record.id, []);
        continue;
      }
      edgesById.set(record.id, edgeResult.data ?? []);
    }

    const beats = records.map((record) =>
      toBeat(record, edgesById.get(record.id) ?? [], knownIds, workflowMap),
    );
    return ok(beats);
  }

  async listWorkflows(
    repoPath?: string,
  ): Promise<BackendResult<MemoryWorkflowDescriptor[]>> {
    const rp = this.resolvePath(repoPath);
    return this.getWorkflowDescriptorsForRepo(rp);
  }

  async list(
    filters?: BeatListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    const rp = this.resolvePath(repoPath);
    const result = await this.buildBeatsForRepo(rp);
    if (!result.ok) return result;
    return ok(applyFilters(result.data ?? [], filters));
  }

  async listReady(
    filters?: BeatListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    const rp = this.resolvePath(repoPath);
    const builtResult = await this.buildBeatsForRepo(rp);
    if (!builtResult.ok) return builtResult;

    const beats = (builtResult.data ?? []).filter((beat) => {
      if (!beat.isAgentClaimable) return false;
      const cached = this.edgeCache.get(this.edgeCacheKey(beat.id, rp));
      const edges = cached?.edges ?? [];
      return !isBlockedByEdges(beat.id, edges);
    });

    return ok(applyFilters(beats, filters));
  }

  async search(
    query: string,
    filters?: BeatListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    const rp = this.resolvePath(repoPath);
    const result = await this.buildBeatsForRepo(rp);
    if (!result.ok) return result;

    const lower = query.toLowerCase();
    const matches = (result.data ?? []).filter((beat) =>
      beat.id.toLowerCase().includes(lower) ||
      beat.title.toLowerCase().includes(lower) ||
      (beat.description ?? "").toLowerCase().includes(lower) ||
      (beat.notes ?? "").toLowerCase().includes(lower),
    );

    return ok(applyFilters(matches, filters));
  }

  async query(
    expression: string,
    _options?: BeatQueryOptions,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    const rp = this.resolvePath(repoPath);
    const result = await this.buildBeatsForRepo(rp);
    if (!result.ok) return result;

    const matches = (result.data ?? []).filter((beat) => matchExpression(beat, expression));
    return ok(matches);
  }

  async get(
    id: string,
    repoPath?: string,
  ): Promise<BackendResult<Beat>> {
    const rp = this.resolvePath(repoPath);
    const knotResult = fromKnots(await knots.showKnot(id, rp));
    if (!knotResult.ok) return propagateError<Beat>(knotResult);

    const edgesResult = await this.getEdgesForId(id, rp);
    if (!edgesResult.ok) return propagateError<Beat>(edgesResult);

    const workflowMapResult = await this.workflowMapByProfileId(rp);
    if (!workflowMapResult.ok) return propagateError<Beat>(workflowMapResult);

    return ok(toBeat(knotResult.data!, edgesResult.data ?? [], new Set([id]), workflowMapResult.data ?? new Map()));
  }

  async create(
    input: CreateBeatInput,
    repoPath?: string,
  ): Promise<BackendResult<{ id: string }>> {
    const rp = this.resolvePath(repoPath);

    const workflowsResult = await this.getWorkflowDescriptorsForRepo(rp);
    if (!workflowsResult.ok) return propagateError<{ id: string }>(workflowsResult);
    const workflows = workflowsResult.data ?? [];
    if (workflows.length === 0) {
      return backendError("INVALID_INPUT", "No profiles available for knot creation");
    }

    const workflowsById = new Map(workflows.map((workflow) => [workflow.id, workflow]));
    const selectedWorkflowId = input.profileId ?? input.workflowId ?? "autopilot";
    const selectedWorkflow = workflowsById.get(selectedWorkflowId) ?? workflows[0];
    if (!selectedWorkflow) {
      return backendError("INVALID_INPUT", `Unknown profile "${selectedWorkflowId}" for knots backend`);
    }

    const createResult = fromKnots(
      await knots.newKnot(
        input.title,
        {
          description: input.description,
          state: selectedWorkflow.initialState,
          profile: selectedWorkflow.id,
        },
        rp,
      ),
    );
    if (!createResult.ok) return propagateError<{ id: string }>(createResult);

    const id = createResult.data!.id;

    const patch: KnotUpdateInput = {};
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.type) patch.type = input.type;
    if (input.labels?.length) patch.addTags = input.labels;
    if (input.notes) patch.addNote = input.notes;

    const hasPatch =
      patch.priority !== undefined ||
      patch.type !== undefined ||
      (patch.addTags?.length ?? 0) > 0 ||
      patch.addNote !== undefined;

    if (hasPatch) {
      const updateResult = fromKnots(await knots.updateKnot(id, patch, rp));
      if (!updateResult.ok) return propagateError<{ id: string }>(updateResult);
    }

    if (input.acceptance) {
      const acceptanceUpdate = fromKnots(
        await knots.updateKnot(
          id,
          { addNote: `Acceptance Criteria:\n${input.acceptance}` },
          rp,
        ),
      );
      if (!acceptanceUpdate.ok) return propagateError<{ id: string }>(acceptanceUpdate);
    }

    if (input.parent) {
      const parentResult = fromKnots(await knots.addEdge(input.parent, "parent_of", id, rp));
      if (!parentResult.ok) return propagateError<{ id: string }>(parentResult);
      this.invalidateEdgeCache(rp, input.parent);
      this.invalidateEdgeCache(rp, id);
    }

    return ok({ id });
  }

  async update(
    id: string,
    input: UpdateBeatInput,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    const rp = this.resolvePath(repoPath);

    if (input.profileId) {
      return backendError(
        "INVALID_INPUT",
        "Knots does not support changing profileId after creation",
      );
    }

    const currentResult = await this.get(id, rp);
    if (!currentResult.ok || !currentResult.data) {
      return propagateError<void>(currentResult);
    }
    const current = currentResult.data;
    const workflowsResult = await this.getWorkflowDescriptorsForRepo(rp);
    if (!workflowsResult.ok) return propagateError<void>(workflowsResult);
    const workflows = workflowsResult.data ?? [];
    const workflow =
      workflows.find((item) => item.id === (current.profileId ?? current.workflowId)) ?? workflows[0];

    const patch: KnotUpdateInput = {};

    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.priority !== undefined) patch.priority = input.priority;

    if (input.state !== undefined) {
      const normalizedState = workflow
        ? normalizeStateForWorkflow(input.state, workflow)
        : input.state.trim().toLowerCase();
      patch.status = normalizedState;
    }

    if (input.type !== undefined) patch.type = input.type;
    if (input.labels?.length) patch.addTags = input.labels;
    if (input.removeLabels?.length) patch.removeTags = input.removeLabels;
    if (input.notes !== undefined) patch.addNote = input.notes;

    const hasPatch =
      patch.title !== undefined ||
      patch.description !== undefined ||
      patch.priority !== undefined ||
      patch.status !== undefined ||
      patch.type !== undefined ||
      (patch.addTags?.length ?? 0) > 0 ||
      (patch.removeTags?.length ?? 0) > 0 ||
      patch.addNote !== undefined;

    if (hasPatch) {
      const patchResult = fromKnots(await knots.updateKnot(id, patch, rp));
      if (!patchResult.ok) return propagateError<void>(patchResult);
    }

    if (input.acceptance !== undefined) {
      const acceptanceResult = fromKnots(
        await knots.updateKnot(
          id,
          { addNote: `Acceptance Criteria:\n${input.acceptance}` },
          rp,
        ),
      );
      if (!acceptanceResult.ok) return propagateError<void>(acceptanceResult);
    }

    if (input.parent !== undefined) {
      const incoming = fromKnots(await knots.listEdges(id, "incoming", rp));
      if (!incoming.ok) return propagateError<void>(incoming);

      const existingParents = (incoming.data ?? [])
        .filter((edge) => edge.kind === "parent_of" && edge.dst === id)
        .map((edge) => edge.src);

      const nextParent = input.parent.trim();

      for (const parentId of existingParents) {
        if (nextParent && parentId === nextParent) continue;
        const removeResult = fromKnots(await knots.removeEdge(parentId, "parent_of", id, rp));
        if (!removeResult.ok) return propagateError<void>(removeResult);
        this.invalidateEdgeCache(rp, parentId);
      }

      if (nextParent && !existingParents.includes(nextParent)) {
        const addResult = fromKnots(await knots.addEdge(nextParent, "parent_of", id, rp));
        if (!addResult.ok) return propagateError<void>(addResult);
        this.invalidateEdgeCache(rp, nextParent);
      }

      this.invalidateEdgeCache(rp, id);
    }

    return { ok: true };
  }

  async delete(
    _id: string,
    _repoPath?: string,
  ): Promise<BackendResult<void>> {
    return backendError(
      "UNSUPPORTED",
      "Delete is not supported by the Knots backend",
    );
  }

  async close(
    id: string,
    reason?: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    const rp = this.resolvePath(repoPath);
    const closeResult = fromKnots(
      await knots.updateKnot(
        id,
        {
          status: "shipped",
          force: true,
          addNote: reason ? `Close reason: ${reason}` : undefined,
        },
        rp,
      ),
    );
    if (!closeResult.ok) return propagateError<void>(closeResult);
    return { ok: true };
  }

  async listDependencies(
    id: string,
    repoPath?: string,
    options?: { type?: string },
  ): Promise<BackendResult<BeatDependency[]>> {
    const rp = this.resolvePath(repoPath);

    const showResult = fromKnots(await knots.showKnot(id, rp));
    if (!showResult.ok) return propagateError<BeatDependency[]>(showResult);

    const edgesResult = await this.getEdgesForId(id, rp);
    if (!edgesResult.ok) return propagateError<BeatDependency[]>(edgesResult);

    const deps: BeatDependency[] = [];
    for (const edge of edgesResult.data ?? []) {
      if (edge.kind === "blocked_by") {
        if (options?.type && options.type !== "blocks") continue;
        const blockerId = edge.dst;
        const blockedId = edge.src;
        if (id !== blockerId && id !== blockedId) continue;

        deps.push({
          id: id === blockerId ? blockedId : blockerId,
          type: "blocks",
          source: blockerId,
          target: blockedId,
          dependency_type: "blocked_by",
        });
      }

      if (edge.kind === "parent_of") {
        const parentId = edge.src;
        const childId = edge.dst;
        if (id !== parentId && id !== childId) continue;

        deps.push({
          id: id === parentId ? childId : parentId,
          type: "parent-child",
          source: parentId,
          target: childId,
          dependency_type: "parent_of",
        });
      }
    }

    return ok(deps);
  }

  async addDependency(
    blockerId: string,
    blockedId: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    const rp = this.resolvePath(repoPath);

    const blockerExists = fromKnots(await knots.showKnot(blockerId, rp));
    if (!blockerExists.ok) return propagateError<void>(blockerExists);

    const blockedExists = fromKnots(await knots.showKnot(blockedId, rp));
    if (!blockedExists.ok) return propagateError<void>(blockedExists);

    const addResult = fromKnots(await knots.addEdge(blockedId, "blocked_by", blockerId, rp));
    if (!addResult.ok) return propagateError<void>(addResult);

    this.invalidateEdgeCache(rp, blockerId);
    this.invalidateEdgeCache(rp, blockedId);
    return { ok: true };
  }

  async removeDependency(
    blockerId: string,
    blockedId: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    const rp = this.resolvePath(repoPath);

    const removeResult = fromKnots(await knots.removeEdge(blockedId, "blocked_by", blockerId, rp));
    if (!removeResult.ok) return propagateError<void>(removeResult);

    this.invalidateEdgeCache(rp, blockerId);
    this.invalidateEdgeCache(rp, blockedId);
    return { ok: true };
  }

  async buildTakePrompt(
    beatId: string,
    options?: TakePromptOptions,
    repoPath?: string,
  ): Promise<BackendResult<TakePromptResult>> {
    const rp = this.resolvePath(repoPath);

    if (options?.isParent && options.childBeatIds?.length) {
      // Parent/Scene mode: don't claim upfront — subagents claim children.
      // Return parent metadata with child listing and claim instructions.
      const parentResult = fromKnots(await knots.showKnot(beatId, rp));
      if (!parentResult.ok) return propagateError<TakePromptResult>(parentResult);
      const parent = parentResult.data!;

      const childLines = options.childBeatIds.map(
        (id) => `- Run \`kno claim ${JSON.stringify(id)} --json\` first.`,
      );
      const prompt = [
        `Parent beat ID: ${beatId}`,
        parent.title ? `Title: ${parent.title}` : null,
        parent.description ? `Description: ${parent.description}` : parent.body ? `Description: ${parent.body}` : null,
        ``,
        `Open child beat IDs:`,
        ...options.childBeatIds.map((id) => `- ${id}`),
        ``,
        `KNOTS CLAIM MODE (required):`,
        `Always claim a knot before implementation and follow the claim output verbatim.`,
        ...childLines,
        `- Use the returned \`prompt\` field as the source of truth for each child.`,
        `- Run the completion command from that claim output, then stop work on that child.`,
        `- Do not guess or brute-force workflow transitions outside the claim output.`,
      ].filter((line): line is string => line !== null).join("\n");

      return ok({ prompt, claimed: false });
    }

    // Single-beat Take! mode: claim the knot and return the claim prompt.
    const claimResult = fromKnots(
      await knots.claimKnot(beatId, rp, {
        agentName: options?.agentName,
        agentModel: options?.agentModel,
        agentVersion: options?.agentVersion,
      }),
    );
    if (!claimResult.ok) return propagateError<TakePromptResult>(claimResult);

    return ok({
      prompt: claimResult.data!.prompt,
      claimed: true,
    });
  }

  async buildPollPrompt(
    options?: PollPromptOptions,
    repoPath?: string,
  ): Promise<BackendResult<PollPromptResult>> {
    const rp = this.resolvePath(repoPath);

    const pollResult = fromKnots(
      await knots.pollKnot(rp, {
        agentName: options?.agentName,
        agentModel: options?.agentModel,
        agentVersion: options?.agentVersion,
      }),
    );
    if (!pollResult.ok) return propagateError<PollPromptResult>(pollResult);

    return ok({
      prompt: pollResult.data!.prompt,
      claimedId: pollResult.data!.id,
    });
  }
}
