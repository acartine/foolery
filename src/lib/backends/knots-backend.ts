/**
 * KnotsBackend -- BackendPort adapter backed by the `knots` CLI.
 *
 * Uses Knots as the source of truth and maps Knots fields/states/edges
 * into the existing Foolery BackendPort contract.
 */

import type {
  BackendPort,
  BackendResult,
  BeadListFilters,
  BeadQueryOptions,
} from "@/lib/backend-port";
import type { BackendCapabilities } from "@/lib/backend-capabilities";
import type { BackendErrorCode } from "@/lib/backend-errors";
import { isRetryableByDefault } from "@/lib/backend-errors";
import type { CreateBeadInput, UpdateBeadInput } from "@/lib/schemas";
import type { Bead, BeadDependency, BeadStatus, BeadType } from "@/lib/types";
import type { KnotEdge, KnotRecord, KnotUpdateInput } from "@/lib/knots";
import * as knots from "@/lib/knots";

const EDGE_CACHE_TTL_MS = 2_000;

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

type KnotsState =
  | "idea"
  | "work_item"
  | "implementing"
  | "implemented"
  | "reviewing"
  | "rejected"
  | "refining"
  | "approved"
  | "shipped"
  | "deferred"
  | "abandoned";

interface CachedEdges {
  edges: KnotEdge[];
  expiresAt: number;
}

function ok<T>(data: T): BackendResult<T> {
  return { ok: true, data };
}

function backendError(
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

function mapKnotsStateToStatus(state: string): BeadStatus {
  switch (state) {
    case "idea":
    case "work_item":
      return "open";
    case "implementing":
    case "implemented":
    case "reviewing":
    case "refining":
    case "approved":
      return "in_progress";
    case "rejected":
      return "blocked";
    case "deferred":
      return "deferred";
    case "shipped":
    case "abandoned":
      return "closed";
    default:
      return "open";
  }
}

function mapStatusToKnotsState(status: BeadStatus): KnotsState {
  switch (status) {
    case "open":
      return "work_item";
    case "in_progress":
      return "implementing";
    case "blocked":
      return "rejected";
    case "deferred":
      return "deferred";
    case "closed":
      return "shipped";
    default:
      return "work_item";
  }
}

function normalizeType(raw: string | null | undefined): BeadType {
  if (!raw) return "task";
  const value = raw.toLowerCase();
  const allowed: BeadType[] = [
    "bug",
    "feature",
    "task",
    "epic",
    "chore",
    "merge-request",
    "molecule",
    "gate",
  ];
  return allowed.includes(value as BeadType) ? (value as BeadType) : "task";
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

function isBlockedByEdges(id: string, edges: KnotEdge[]): boolean {
  return edges.some((edge) => edge.kind === "blocked_by" && edge.src === id);
}

function toBead(
  knot: KnotRecord,
  edges: KnotEdge[],
): Bead {
  const status = mapKnotsStateToStatus(knot.state);
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
    type: normalizeType(knot.type),
    status,
    priority: normalizePriority(knot.priority),
    labels: (knot.tags ?? []).filter((tag) => typeof tag === "string" && tag.trim().length > 0),
    notes,
    parent: parentFromEdges(knot.id, edges),
    created: knot.created_at ?? knot.updated_at,
    updated: knot.updated_at,
    closed: status === "closed" ? knot.updated_at : undefined,
    metadata: {
      knotsState: knot.state,
      knotsWorkflowEtag: knot.workflow_etag,
      knotsHandoffCapsules: knot.handoff_capsules ?? [],
      knotsNotes: knot.notes ?? [],
    },
  };
}

function applyFilters(beads: Bead[], filters?: BeadListFilters): Bead[] {
  if (!filters) return beads;
  return beads.filter((b) => {
    if (filters.type && b.type !== filters.type) return false;
    if (filters.status && b.status !== filters.status) return false;
    if (filters.priority !== undefined && b.priority !== filters.priority) return false;
    if (filters.assignee && b.assignee !== filters.assignee) return false;
    if (filters.label && !b.labels.includes(filters.label)) return false;
    if (filters.owner && b.owner !== filters.owner) return false;
    if (filters.parent && b.parent !== filters.parent) return false;
    return true;
  });
}

function matchExpression(bead: Bead, expression: string): boolean {
  const terms = expression.split(/\s+/).filter(Boolean);
  return terms.every((term) => {
    const [field, value] = term.split(":");
    if (!field || !value) return true;
    switch (field) {
      case "status":
        return bead.status === value;
      case "type":
        return bead.type === value;
      case "priority":
        return String(bead.priority) === value;
      case "assignee":
        return bead.assignee === value;
      case "label":
        return bead.labels.includes(value);
      case "owner":
        return bead.owner === value;
      case "parent":
        return bead.parent === value;
      case "id":
        return bead.id === value;
      default:
        return true;
    }
  });
}

function trackerKey(repoPath?: string): string {
  return repoPath ?? process.cwd();
}

export class KnotsBackend implements BackendPort {
  readonly capabilities: BackendCapabilities = KNOTS_CAPABILITIES;

  private defaultRepoPath: string;
  private edgeCache = new Map<string, CachedEdges>();

  constructor(repoPath?: string) {
    this.defaultRepoPath = repoPath ?? process.cwd();
  }

  private resolvePath(repoPath?: string): string {
    return repoPath ?? this.defaultRepoPath;
  }

  private edgeCacheKey(id: string, repoPath: string): string {
    return `${trackerKey(repoPath)}::${id}`;
  }

  private invalidateEdgeCache(repoPath: string, id?: string): void {
    if (!id) {
      const prefix = `${trackerKey(repoPath)}::`;
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

  private async buildBeadsForRepo(repoPath: string): Promise<BackendResult<Bead[]>> {
    const listResult = fromKnots(await knots.listKnots(repoPath));
    if (!listResult.ok) return propagateError<Bead[]>(listResult);

    const records = listResult.data ?? [];
    const edgeResults = await Promise.all(
      records.map(async (record) => [record.id, await this.getEdgesForId(record.id, repoPath)] as const),
    );

    const edgesById = new Map<string, KnotEdge[]>();
    for (const [id, edgeResult] of edgeResults) {
      if (!edgeResult.ok) return propagateError<Bead[]>(edgeResult);
      edgesById.set(id, edgeResult.data ?? []);
    }

    const beads = records.map((record) => toBead(record, edgesById.get(record.id) ?? []));
    return ok(beads);
  }

  async list(
    filters?: BeadListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Bead[]>> {
    const rp = this.resolvePath(repoPath);
    const result = await this.buildBeadsForRepo(rp);
    if (!result.ok) return result;
    return ok(applyFilters(result.data ?? [], filters));
  }

  async listReady(
    filters?: BeadListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Bead[]>> {
    const rp = this.resolvePath(repoPath);
    const listResult = fromKnots(await knots.listKnots(rp));
    if (!listResult.ok) return propagateError<Bead[]>(listResult);

    const records = listResult.data ?? [];
    const edgeResults = await Promise.all(
      records.map(async (record) => [record.id, await this.getEdgesForId(record.id, rp)] as const),
    );

    const edgesById = new Map<string, KnotEdge[]>();
    for (const [id, edgeResult] of edgeResults) {
      if (!edgeResult.ok) return propagateError<Bead[]>(edgeResult);
      edgesById.set(id, edgeResult.data ?? []);
    }

    const beads = records
      .map((record) => toBead(record, edgesById.get(record.id) ?? []))
      .filter((bead) => bead.status === "open" && !isBlockedByEdges(bead.id, edgesById.get(bead.id) ?? []));

    return ok(applyFilters(beads, filters));
  }

  async search(
    query: string,
    filters?: BeadListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Bead[]>> {
    const rp = this.resolvePath(repoPath);
    const result = await this.buildBeadsForRepo(rp);
    if (!result.ok) return result;

    const lower = query.toLowerCase();
    const matches = (result.data ?? []).filter((bead) =>
      bead.id.toLowerCase().includes(lower) ||
      bead.title.toLowerCase().includes(lower) ||
      (bead.description ?? "").toLowerCase().includes(lower) ||
      (bead.notes ?? "").toLowerCase().includes(lower),
    );

    return ok(applyFilters(matches, filters));
  }

  async query(
    expression: string,
    _options?: BeadQueryOptions,
    repoPath?: string,
  ): Promise<BackendResult<Bead[]>> {
    const rp = this.resolvePath(repoPath);
    const result = await this.buildBeadsForRepo(rp);
    if (!result.ok) return result;

    const matches = (result.data ?? []).filter((bead) => matchExpression(bead, expression));
    return ok(matches);
  }

  async get(
    id: string,
    repoPath?: string,
  ): Promise<BackendResult<Bead>> {
    const rp = this.resolvePath(repoPath);
    const knotResult = fromKnots(await knots.showKnot(id, rp));
    if (!knotResult.ok) return propagateError<Bead>(knotResult);

    const edgesResult = await this.getEdgesForId(id, rp);
    if (!edgesResult.ok) return propagateError<Bead>(edgesResult);

    return ok(toBead(knotResult.data!, edgesResult.data ?? []));
  }

  async create(
    input: CreateBeadInput,
    repoPath?: string,
  ): Promise<BackendResult<{ id: string }>> {
    const rp = this.resolvePath(repoPath);

    const createResult = fromKnots(
      await knots.newKnot(
        input.title,
        {
          body: input.description,
          state: mapStatusToKnotsState("open"),
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
    input: UpdateBeadInput,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    const rp = this.resolvePath(repoPath);

    const patch: KnotUpdateInput = {};

    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.status !== undefined) patch.status = mapStatusToKnotsState(input.status);
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
      "INVALID_INPUT",
      "Knots backend does not support deleting knots",
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
  ): Promise<BackendResult<BeadDependency[]>> {
    const rp = this.resolvePath(repoPath);

    const showResult = fromKnots(await knots.showKnot(id, rp));
    if (!showResult.ok) return propagateError<BeadDependency[]>(showResult);

    const edgesResult = await this.getEdgesForId(id, rp);
    if (!edgesResult.ok) return propagateError<BeadDependency[]>(edgesResult);

    const deps: BeadDependency[] = [];
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
    const result = fromKnots(await knots.addEdge(blockedId, "blocked_by", blockerId, rp));
    if (!result.ok) return propagateError<void>(result);
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
    const result = fromKnots(await knots.removeEdge(blockedId, "blocked_by", blockerId, rp));
    if (!result.ok) return propagateError<void>(result);
    this.invalidateEdgeCache(rp, blockerId);
    this.invalidateEdgeCache(rp, blockedId);
    return { ok: true };
  }
}
