/**
 * BeadsBackend -- BackendPort adapter backed by .beads/issues.jsonl files.
 *
 * Reads and writes JSONL directly, bypassing the `bd` CLI entirely.
 * Lazily loads the JSONL into an in-memory Map on first access per
 * repoPath and flushes to disk after every mutation.
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
import type { Bead, BeadDependency, MemoryWorkflowDescriptor } from "@/lib/types";
import { recordCompatStatusConsumed } from "@/lib/compat-status-usage";
import { normalizeFromJsonl, denormalizeToJsonl } from "./beads-jsonl-dto";
import type { RawBead } from "./beads-jsonl-dto";
import {
  readJsonlFile,
  writeJsonlFile,
  resolveJsonlPath,
  resolveDepsPath,
  readJsonlRecords,
  writeJsonlRecords,
} from "./beads-jsonl-io";
import {
  BEADS_COARSE_WORKFLOW_ID,
  beadsCoarseWorkflowDescriptor,
  mapStatusToDefaultWorkflowState,
  mapWorkflowStateToCompatStatus,
} from "@/lib/workflows";

// ── Capabilities ────────────────────────────────────────────────

export const BEADS_CAPABILITIES: Readonly<BackendCapabilities> = Object.freeze({
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canClose: true,
  canSearch: true,
  canQuery: true,
  canListReady: true,
  canManageDependencies: true,
  canManageLabels: true,
  canSync: false,
  maxConcurrency: 1,
});

// ── Result helpers ──────────────────────────────────────────────

function ok<T>(data: T): BackendResult<T> {
  return { ok: true, data };
}

function backendError(
  code: BackendErrorCode,
  message: string,
): BackendResult<never> {
  return { ok: false, error: { code, message, retryable: isRetryableByDefault(code) } };
}

// ── Dependency record ───────────────────────────────────────────

interface DepRecord {
  blockerId: string;
  blockedId: string;
}

// ── Per-repo in-memory cache ────────────────────────────────────

interface RepoCache {
  beads: Map<string, Bead>;
  deps: DepRecord[];
  loaded: boolean;
}

// ── ID generation ───────────────────────────────────────────────

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `beads-${ts}-${rand}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

// ── BeadsBackend ────────────────────────────────────────────────

export class BeadsBackend implements BackendPort {
  readonly capabilities: BackendCapabilities = BEADS_CAPABILITIES;
  private defaultRepoPath: string;
  private cache = new Map<string, RepoCache>();

  constructor(repoPath?: string) {
    this.defaultRepoPath = repoPath ?? process.cwd();
  }

  // -- Internal: cache management -----------------------------------------

  private resolvePath(repoPath?: string): string {
    return repoPath ?? this.defaultRepoPath;
  }

  private async ensureLoaded(repoPath: string): Promise<RepoCache> {
    const existing = this.cache.get(repoPath);
    if (existing?.loaded) return existing;

    const filePath = resolveJsonlPath(repoPath);
    const rawRecords = await readJsonlFile(filePath);
    const beads = new Map<string, Bead>();
    for (const raw of rawRecords) {
      const bead = normalizeFromJsonl(raw);
      beads.set(bead.id, bead);
    }

    const depsPath = resolveDepsPath(repoPath);
    const deps = await readJsonlRecords<DepRecord>(depsPath);

    const entry: RepoCache = { beads, deps, loaded: true };
    this.cache.set(repoPath, entry);
    return entry;
  }

  private async flush(repoPath: string): Promise<void> {
    const entry = this.cache.get(repoPath);
    if (!entry) return;
    const filePath = resolveJsonlPath(repoPath);
    const records: RawBead[] = Array.from(entry.beads.values()).map(denormalizeToJsonl);
    await writeJsonlFile(filePath, records);

    const depsPath = resolveDepsPath(repoPath);
    await writeJsonlRecords(depsPath, entry.deps);
  }

  /** Clear all cached state. Exposed for test teardown. */
  _reset(): void {
    this.cache.clear();
  }

  async listWorkflows(
    _repoPath?: string,
  ): Promise<BackendResult<MemoryWorkflowDescriptor[]>> {
    return ok([beadsCoarseWorkflowDescriptor()]);
  }

  // -- Read operations ----------------------------------------------------

  async list(
    filters?: BeadListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Bead[]>> {
    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    let items = Array.from(entry.beads.values());
    items = applyFilters(items, filters);
    return ok(items);
  }

  async listReady(
    filters?: BeadListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Bead[]>> {
    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    const blockedIds = new Set(entry.deps.map((d) => d.blockedId));
    let items = Array.from(entry.beads.values()).filter(
      (b) => b.status === "open" && !blockedIds.has(b.id),
    );
    items = applyFilters(items, filters);
    return ok(items);
  }

  async search(
    query: string,
    filters?: BeadListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Bead[]>> {
    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    const lower = query.toLowerCase();
    let items = Array.from(entry.beads.values()).filter(
      (b) =>
        b.title.toLowerCase().includes(lower) ||
        (b.description ?? "").toLowerCase().includes(lower),
    );
    items = applyFilters(items, filters);
    return ok(items);
  }

  async query(
    expression: string,
    _options?: BeadQueryOptions,
    repoPath?: string,
  ): Promise<BackendResult<Bead[]>> {
    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    const items = Array.from(entry.beads.values()).filter((b) =>
      matchExpression(b, expression),
    );
    return ok(items);
  }

  async get(
    id: string,
    repoPath?: string,
  ): Promise<BackendResult<Bead>> {
    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    const bead = entry.beads.get(id);
    if (!bead) return backendError("NOT_FOUND", `Bead ${id} not found`);
    return ok(bead);
  }

  // -- Write operations ---------------------------------------------------

  async create(
    input: CreateBeadInput,
    repoPath?: string,
  ): Promise<BackendResult<{ id: string }>> {
    if (input.workflowId && input.workflowId !== BEADS_COARSE_WORKFLOW_ID) {
      return backendError(
        "INVALID_INPUT",
        `Unknown workflow "${input.workflowId}" for beads backend`,
      );
    }

    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    const id = generateId();
    const now = isoNow();
    const workflowState = beadsCoarseWorkflowDescriptor().initialState;
    const compatStatus = mapWorkflowStateToCompatStatus(workflowState, "beads-backend:create");
    const bead: Bead = {
      id,
      title: input.title,
      description: input.description,
      type: input.type ?? "task",
      status: compatStatus,
      compatStatus,
      workflowId: BEADS_COARSE_WORKFLOW_ID,
      workflowMode: "coarse_human_gated",
      workflowState,
      priority: input.priority ?? 2,
      labels: input.labels ?? [],
      assignee: input.assignee,
      parent: input.parent,
      due: input.due,
      acceptance: input.acceptance,
      notes: input.notes,
      estimate: input.estimate,
      created: now,
      updated: now,
    };
    entry.beads.set(id, bead);
    await this.flush(rp);
    return ok({ id });
  }

  async update(
    id: string,
    input: UpdateBeadInput,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    const bead = entry.beads.get(id);
    if (!bead) return backendError("NOT_FOUND", `Bead ${id} not found`);
    applyUpdate(bead, input);
    bead.updated = isoNow();
    await this.flush(rp);
    return { ok: true };
  }

  async delete(
    id: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    if (!entry.beads.has(id)) {
      return backendError("NOT_FOUND", `Bead ${id} not found`);
    }
    entry.beads.delete(id);
    entry.deps = entry.deps.filter(
      (d) => d.blockerId !== id && d.blockedId !== id,
    );
    await this.flush(rp);
    return { ok: true };
  }

  async close(
    id: string,
    reason?: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    const bead = entry.beads.get(id);
    if (!bead) return backendError("NOT_FOUND", `Bead ${id} not found`);
    bead.status = "closed";
    bead.compatStatus = "closed";
    bead.workflowState = "closed";
    bead.closed = isoNow();
    bead.updated = isoNow();
    if (reason) {
      bead.metadata = { ...bead.metadata, close_reason: reason };
    }
    await this.flush(rp);
    return { ok: true };
  }

  // -- Dependency operations ----------------------------------------------

  async listDependencies(
    id: string,
    repoPath?: string,
    options?: { type?: string },
  ): Promise<BackendResult<BeadDependency[]>> {
    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    if (!entry.beads.has(id)) {
      return backendError("NOT_FOUND", `Bead ${id} not found`);
    }
    let matches = entry.deps.filter(
      (d) => d.blockerId === id || d.blockedId === id,
    );
    if (options?.type) {
      matches = matches.filter(() => options.type === "blocks");
    }
    const result: BeadDependency[] = matches.map((d) => ({
      id: d.blockerId === id ? d.blockedId : d.blockerId,
      type: "blocks",
      source: d.blockerId,
      target: d.blockedId,
    }));
    return ok(result);
  }

  async addDependency(
    blockerId: string,
    blockedId: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    if (!entry.beads.has(blockerId)) {
      return backendError("NOT_FOUND", `Bead ${blockerId} not found`);
    }
    if (!entry.beads.has(blockedId)) {
      return backendError("NOT_FOUND", `Bead ${blockedId} not found`);
    }
    const exists = entry.deps.some(
      (d) => d.blockerId === blockerId && d.blockedId === blockedId,
    );
    if (exists) {
      return backendError(
        "ALREADY_EXISTS",
        `Dependency ${blockerId} -> ${blockedId} already exists`,
      );
    }
    entry.deps.push({ blockerId, blockedId });
    await this.flush(rp);
    return { ok: true };
  }

  async removeDependency(
    blockerId: string,
    blockedId: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    const idx = entry.deps.findIndex(
      (d) => d.blockerId === blockerId && d.blockedId === blockedId,
    );
    if (idx === -1) {
      return backendError(
        "NOT_FOUND",
        `Dependency ${blockerId} -> ${blockedId} not found`,
      );
    }
    entry.deps.splice(idx, 1);
    await this.flush(rp);
    return { ok: true };
  }
}

// ── Internal helpers (kept below 75 lines each) ─────────────────

function applyFilters(beads: Bead[], filters?: BeadListFilters): Bead[] {
  if (!filters) return beads;
  return beads.filter((b) => {
    if (filters.workflowId && b.workflowId !== filters.workflowId) return false;
    if (filters.workflowState && b.workflowState !== filters.workflowState) return false;
    if (filters.type && b.type !== filters.type) return false;
    if (filters.status && b.status !== filters.status) return false;
    if (filters.priority !== undefined && b.priority !== filters.priority)
      return false;
    if (filters.assignee && b.assignee !== filters.assignee) return false;
    if (filters.label && !b.labels.includes(filters.label)) return false;
    if (filters.owner && b.owner !== filters.owner) return false;
    if (filters.parent && b.parent !== filters.parent) return false;
    return true;
  });
}

function applyUpdate(bead: Bead, input: UpdateBeadInput): void {
  if (input.title !== undefined) bead.title = input.title;
  if (input.description !== undefined) bead.description = input.description;
  if (input.type !== undefined) bead.type = input.type;
  if (input.workflowState !== undefined) {
    bead.workflowState = input.workflowState.trim().toLowerCase();
    const compatStatus = mapWorkflowStateToCompatStatus(bead.workflowState, "beads-backend:update");
    bead.compatStatus = compatStatus;
    bead.status = compatStatus;
  }
  if (input.status !== undefined) {
    bead.status = input.status;
    recordCompatStatusConsumed("beads-backend:update-input-status");
    bead.compatStatus = input.status;
    if (input.workflowState === undefined) {
      bead.workflowState = mapStatusToDefaultWorkflowState(input.status);
    }
  }
  if (input.priority !== undefined) bead.priority = input.priority;
  if (input.parent !== undefined) bead.parent = input.parent;
  if (input.labels !== undefined) {
    bead.labels = [...new Set([...bead.labels, ...input.labels])];
  }
  if (input.removeLabels !== undefined) {
    bead.labels = bead.labels.filter((l) => !input.removeLabels!.includes(l));
  }
  if (input.assignee !== undefined) bead.assignee = input.assignee;
  if (input.due !== undefined) bead.due = input.due;
  if (input.acceptance !== undefined) bead.acceptance = input.acceptance;
  if (input.notes !== undefined) bead.notes = input.notes;
  if (input.estimate !== undefined) bead.estimate = input.estimate;
}

function matchExpression(bead: Bead, expression: string): boolean {
  const terms = expression.split(/\s+/);
  return terms.every((term) => {
    const [field, value] = term.split(":");
    if (!field || !value) return true;
    switch (field) {
      case "status":
        return bead.status === value;
      case "workflow":
      case "workflowid":
        return bead.workflowId === value;
      case "workflowstate":
      case "state":
        return bead.workflowState === value;
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
      default:
        return true;
    }
  });
}
