/**
 * KnotsBackend -- BackendPort adapter backed by the `kno` CLI.
 *
 * Uses Knots as the source of truth and maps profile/state ownership into
 * Foolery's backend contract.
 *
 * Implementation is split across sibling modules to stay within the
 * 500-line file limit:
 *   - knots-backend-helpers.ts   (result wrappers, data normalisation)
 *   - knots-backend-mappers.ts   (toBeat, applyFilters, matchExpression)
 *   - knots-backend-update.ts    (update-method helpers)
 *   - knots-skill-prompts.ts     (BUILTIN_SKILL_PROMPTS)
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
import type { CreateBeatInput, UpdateBeatInput } from "@/lib/schemas";
import type {
  Beat,
  BeatDependency,
  MemoryWorkflowDescriptor,
} from "@/lib/types";
import type { KnotEdge } from "@/lib/knots";
import * as knots from "@/lib/knots";

import {
  ok,
  backendError,
  propagateError,
  fromKnots,
  loadKnotRecordWithRehydrate,
  mapForProfiles,
  isBlockedByEdges,
  collectAliases,
} from "@/lib/backends/knots-backend-helpers";

import {
  toBeat,
  applyFilters,
  matchExpression,
  memoryManagerKey,
} from "@/lib/backends/knots-backend-mappers";

import {
  applyProfileChange,
  buildUpdatePatch,
  hasPatchFields,
  updateParentEdges,
  createKnotImpl,
} from "@/lib/backends/knots-backend-update";

import {
  listDependenciesImpl,
  addDependencyImpl,
  removeDependencyImpl,
  buildParentTakePrompt,
  buildSingleTakePrompt,
  buildPollPromptImpl,
} from "@/lib/backends/knots-backend-prompts";

// Re-export public constants so existing imports keep working.
export { BUILTIN_SKILL_PROMPTS } from "@/lib/backends/knots-skill-prompts";

export const KNOTS_CAPABILITIES: Readonly<BackendCapabilities> =
  Object.freeze({
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

const EDGE_CACHE_TTL_MS = 2_000;
const WORKFLOW_CACHE_TTL_MS = 10_000;

interface CachedEdges {
  edges: KnotEdge[];
  expiresAt: number;
}

interface CachedWorkflows {
  workflows: MemoryWorkflowDescriptor[];
  expiresAt: number;
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

    const rawProfiles = fromKnots(
      await knots.listProfiles(repoPath),
    );
    if (!rawProfiles.ok) {
      return propagateError<MemoryWorkflowDescriptor[]>(
        rawProfiles,
      );
    }

    const normalized = mapForProfiles(rawProfiles.data ?? []);
    if (normalized.length === 0) {
      return backendError(
        "INVALID_INPUT",
        "No profiles available in knots backend",
      );
    }

    this.workflowCache.set(key, {
      workflows: normalized,
      expiresAt: Date.now() + WORKFLOW_CACHE_TTL_MS,
    });
    return ok(normalized);
  }

  private async workflowMapByProfileId(
    repoPath: string,
  ): Promise<
    BackendResult<Map<string, MemoryWorkflowDescriptor>>
  > {
    const workflowsResult =
      await this.getWorkflowDescriptorsForRepo(repoPath);
    if (!workflowsResult.ok) {
      return propagateError<
        Map<string, MemoryWorkflowDescriptor>
      >(workflowsResult);
    }

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

  invalidateEdgeCache(repoPath: string, id?: string): void {
    if (!id) {
      const prefix = `${memoryManagerKey(repoPath)}::`;
      for (const key of this.edgeCache.keys()) {
        if (key.startsWith(prefix)) this.edgeCache.delete(key);
      }
      return;
    }
    this.edgeCache.delete(this.edgeCacheKey(id, repoPath));
  }

  private async getEdgesForId(
    id: string,
    repoPath: string,
  ): Promise<BackendResult<KnotEdge[]>> {
    const key = this.edgeCacheKey(id, repoPath);
    const cached = this.edgeCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return ok(cached.edges);
    }

    const edgesResult = fromKnots(
      await knots.listEdges(id, "both", repoPath),
    );
    if (!edgesResult.ok) {
      return propagateError<KnotEdge[]>(edgesResult);
    }

    const edges = edgesResult.data ?? [];
    this.edgeCache.set(key, {
      edges,
      expiresAt: Date.now() + EDGE_CACHE_TTL_MS,
    });
    return ok(edges);
  }

  private async buildBeatsForRepo(
    repoPath: string,
  ): Promise<BackendResult<Beat[]>> {
    const workflowMapResult =
      await this.workflowMapByProfileId(repoPath);
    if (!workflowMapResult.ok) {
      return propagateError<Beat[]>(workflowMapResult);
    }
    const workflowMap =
      workflowMapResult.data ??
      new Map<string, MemoryWorkflowDescriptor>();

    const listResult = fromKnots(
      await knots.listKnots(repoPath),
    );
    if (!listResult.ok) {
      return propagateError<Beat[]>(listResult);
    }

    const records = listResult.data ?? [];
    const knownIds = new Set(records.map((record) => record.id));

    const aliasToId = new Map<string, string>();
    for (const record of records) {
      for (const a of collectAliases(record)) {
        aliasToId.set(a, record.id);
      }
    }

    const edgesById = new Map<string, KnotEdge[]>();
    for (const record of records) {
      const edgeResult = await this.getEdgesForId(
        record.id,
        repoPath,
      );
      if (!edgeResult.ok) {
        edgesById.set(record.id, []);
        continue;
      }
      edgesById.set(record.id, edgeResult.data ?? []);
    }

    const beats = records.map((record) =>
      toBeat(
        record,
        edgesById.get(record.id) ?? [],
        knownIds,
        aliasToId,
        workflowMap,
      ),
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
      const cached = this.edgeCache.get(
        this.edgeCacheKey(beat.id, rp),
      );
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
    const matches = (result.data ?? []).filter(
      (beat) =>
        beat.id.toLowerCase().includes(lower) ||
        (beat.aliases ?? []).some((alias) =>
          alias.toLowerCase().includes(lower),
        ) ||
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

    const matches = (result.data ?? []).filter((beat) =>
      matchExpression(beat, expression),
    );
    return ok(matches);
  }

  async get(
    id: string,
    repoPath?: string,
  ): Promise<BackendResult<Beat>> {
    const rp = this.resolvePath(repoPath);
    const knotResult = await loadKnotRecordWithRehydrate(id, rp);
    if (!knotResult.ok) {
      return propagateError<Beat>(knotResult);
    }

    const knotId = knotResult.data!.id;

    const edgesResult = await this.getEdgesForId(knotId, rp);
    if (!edgesResult.ok) {
      return propagateError<Beat>(edgesResult);
    }

    const workflowMapResult =
      await this.workflowMapByProfileId(rp);
    if (!workflowMapResult.ok) {
      return propagateError<Beat>(workflowMapResult);
    }

    return ok(
      toBeat(
        knotResult.data!,
        edgesResult.data ?? [],
        new Set([knotId]),
        new Map(),
        workflowMapResult.data ?? new Map(),
      ),
    );
  }

  async create(
    input: CreateBeatInput,
    repoPath?: string,
  ): Promise<BackendResult<{ id: string }>> {
    const rp = this.resolvePath(repoPath);

    const workflowsResult =
      await this.getWorkflowDescriptorsForRepo(rp);
    if (!workflowsResult.ok) {
      return propagateError<{ id: string }>(workflowsResult);
    }
    const workflows = workflowsResult.data ?? [];
    if (workflows.length === 0) {
      return backendError(
        "INVALID_INPUT",
        "No profiles available for knot creation",
      );
    }

    const workflowsById = new Map(
      workflows.map((wf) => [wf.id, wf]),
    );
    const selectedWorkflowId =
      input.profileId ?? input.workflowId ?? "autopilot";
    const selectedWorkflow =
      workflowsById.get(selectedWorkflowId) ?? workflows[0];
    if (!selectedWorkflow) {
      return backendError(
        "INVALID_INPUT",
        `Unknown profile "${selectedWorkflowId}" ` +
          `for knots backend`,
      );
    }

    return createKnotImpl(
      input,
      rp,
      selectedWorkflow,
      this.invalidateEdgeCache.bind(this),
    );
  }

  async update(
    id: string,
    input: UpdateBeatInput,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    const rp = this.resolvePath(repoPath);

    const currentResult = await this.get(id, rp);
    if (!currentResult.ok || !currentResult.data) {
      return propagateError<void>(currentResult);
    }
    const current = currentResult.data;
    const workflowsResult =
      await this.getWorkflowDescriptorsForRepo(rp);
    if (!workflowsResult.ok) {
      return propagateError<void>(workflowsResult);
    }
    const workflows = workflowsResult.data ?? [];

    const profileChangeResult = await applyProfileChange(
      id,
      rp,
      current,
      input,
      workflows,
    );
    if (!("workflow" in profileChangeResult)) {
      return profileChangeResult;
    }
    const { workflow, stateHandledByProfileSet } =
      profileChangeResult;

    const patch = buildUpdatePatch(
      current,
      input,
      workflow,
      stateHandledByProfileSet,
    );

    if (hasPatchFields(patch)) {
      const patchResult = fromKnots(
        await knots.updateKnot(id, patch, rp),
      );
      if (!patchResult.ok) {
        return propagateError<void>(patchResult);
      }
    }

    if (input.parent !== undefined) {
      const edgeResult = await updateParentEdges(
        id,
        input.parent,
        rp,
        this.invalidateEdgeCache.bind(this),
      );
      if (edgeResult) return edgeResult;
    }

    return { ok: true };
  }

  async delete(): Promise<BackendResult<void>> {
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
          addNote: reason
            ? `Close reason: ${reason}`
            : undefined,
        },
        rp,
      ),
    );
    if (!closeResult.ok) {
      return propagateError<void>(closeResult);
    }
    return { ok: true };
  }

  async listDependencies(
    id: string,
    repoPath?: string,
    options?: { type?: string },
  ): Promise<BackendResult<BeatDependency[]>> {
    const rp = this.resolvePath(repoPath);
    return listDependenciesImpl(
      id,
      rp,
      this.getEdgesForId.bind(this),
      options,
    );
  }

  async addDependency(
    blockerId: string,
    blockedId: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    const rp = this.resolvePath(repoPath);
    return addDependencyImpl(
      blockerId,
      blockedId,
      rp,
      this.invalidateEdgeCache.bind(this),
    );
  }

  async removeDependency(
    blockerId: string,
    blockedId: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    const rp = this.resolvePath(repoPath);
    return removeDependencyImpl(
      blockerId,
      blockedId,
      rp,
      this.invalidateEdgeCache.bind(this),
    );
  }

  async buildTakePrompt(
    beatId: string,
    options?: TakePromptOptions,
    repoPath?: string,
  ): Promise<BackendResult<TakePromptResult>> {
    const rp = this.resolvePath(repoPath);
    if (options?.isParent && options.childBeatIds?.length) {
      return buildParentTakePrompt(beatId, options, rp);
    }
    return buildSingleTakePrompt(beatId, options, rp);
  }

  async buildPollPrompt(
    options?: PollPromptOptions,
    repoPath?: string,
  ): Promise<BackendResult<PollPromptResult>> {
    const rp = this.resolvePath(repoPath);
    return buildPollPromptImpl(rp, options);
  }
}
