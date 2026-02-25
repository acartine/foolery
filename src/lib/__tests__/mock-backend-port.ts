/**
 * In-memory mock implementation of BackendPort.
 *
 * Serves two purposes:
 *  1. Reference implementation showing how to satisfy the BackendPort contract.
 *  2. Self-test target for the contract test harness.
 */

import type { Bead, BeadDependency, BeadStatus, MemoryWorkflowDescriptor } from "@/lib/types";
import type { CreateBeadInput, UpdateBeadInput } from "@/lib/schemas";
import type { BackendPort, BackendResult, BeadListFilters } from "@/lib/backend-port";
import type { BackendCapabilities } from "@/lib/backend-capabilities";
import type { BackendErrorCode } from "@/lib/backend-errors";
import { beadsCoarseWorkflowDescriptor, mapStatusToDefaultWorkflowState } from "@/lib/workflows";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;

function nextId(): string {
  idCounter += 1;
  return `mock-${idCounter}`;
}

function resetIdCounter(): void {
  idCounter = 0;
}

function isoNow(): string {
  return new Date().toISOString();
}

function backendError(
  code: BackendErrorCode,
  message: string,
  retryable = false,
): BackendResult<never> {
  return { ok: false, error: { code, message, retryable } };
}

function ok<T>(data: T): BackendResult<T> {
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// Dependency record
// ---------------------------------------------------------------------------

interface DepRecord {
  blockerId: string;
  blockedId: string;
}

// ---------------------------------------------------------------------------
// MockBackendPort
// ---------------------------------------------------------------------------

export class MockBackendPort implements BackendPort {
  private beads = new Map<string, Bead>();
  private deps: DepRecord[] = [];

  async listWorkflows(
    _repoPath?: string,
  ): Promise<BackendResult<MemoryWorkflowDescriptor[]>> {
    return ok([beadsCoarseWorkflowDescriptor()]);
  }

  // -- Read operations ------------------------------------------------------

  async list(
    filters?: BeadListFilters,
    _repoPath?: string,
  ): Promise<BackendResult<Bead[]>> {
    let items = Array.from(this.beads.values());
    items = applyFilters(items, filters);
    return ok(items);
  }

  async listReady(
    filters?: BeadListFilters,
    _repoPath?: string,
  ): Promise<BackendResult<Bead[]>> {
    let items = Array.from(this.beads.values()).filter(
      (b) => b.status === "open",
    );
    items = applyFilters(items, filters);
    return ok(items);
  }

  async search(
    query: string,
    filters?: BeadListFilters,
    _repoPath?: string,
  ): Promise<BackendResult<Bead[]>> {
    const lower = query.toLowerCase();
    let items = Array.from(this.beads.values()).filter(
      (b) =>
        b.title.toLowerCase().includes(lower) ||
        (b.description ?? "").toLowerCase().includes(lower),
    );
    items = applyFilters(items, filters);
    return ok(items);
  }

  async query(
    expression: string,
    _options?: { limit?: number; sort?: string },
    _repoPath?: string,
  ): Promise<BackendResult<Bead[]>> {
    // Minimal expression support: "status:VALUE" or "type:VALUE"
    const items = Array.from(this.beads.values()).filter((b) =>
      matchExpression(b, expression),
    );
    return ok(items);
  }

  async get(
    id: string,
    _repoPath?: string,
  ): Promise<BackendResult<Bead>> {
    const bead = this.beads.get(id);
    if (!bead) return backendError("NOT_FOUND", `Bead ${id} not found`);
    return ok(bead);
  }

  // -- Write operations -----------------------------------------------------

  async create(
    input: CreateBeadInput,
    _repoPath?: string,
  ): Promise<BackendResult<{ id: string }>> {
    const id = nextId();
    const now = isoNow();
    const bead: Bead = {
      id,
      title: input.title,
      description: input.description,
      type: input.type ?? "task",
      status: "open",
      compatStatus: "open",
      workflowId: beadsCoarseWorkflowDescriptor().id,
      workflowMode: "coarse_human_gated",
      workflowState: mapStatusToDefaultWorkflowState("open"),
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
    this.beads.set(id, bead);
    return ok({ id });
  }

  async update(
    id: string,
    input: UpdateBeadInput,
    _repoPath?: string,
  ): Promise<BackendResult<void>> {
    const bead = this.beads.get(id);
    if (!bead) return backendError("NOT_FOUND", `Bead ${id} not found`);
    applyUpdate(bead, input);
    bead.updated = isoNow();
    return { ok: true };
  }

  async delete(
    id: string,
    _repoPath?: string,
  ): Promise<BackendResult<void>> {
    if (!this.beads.has(id)) {
      return backendError("NOT_FOUND", `Bead ${id} not found`);
    }
    this.beads.delete(id);
    this.deps = this.deps.filter(
      (d) => d.blockerId !== id && d.blockedId !== id,
    );
    return { ok: true };
  }

  async close(
    id: string,
    _reason?: string,
    _repoPath?: string,
  ): Promise<BackendResult<void>> {
    const bead = this.beads.get(id);
    if (!bead) return backendError("NOT_FOUND", `Bead ${id} not found`);
    bead.status = "closed";
    bead.compatStatus = "closed";
    bead.workflowState = mapStatusToDefaultWorkflowState("closed");
    bead.closed = isoNow();
    bead.updated = isoNow();
    return { ok: true };
  }

  // -- Dependency operations ------------------------------------------------

  async listDependencies(
    id: string,
    _repoPath?: string,
    options?: { type?: string },
  ): Promise<BackendResult<BeadDependency[]>> {
    if (!this.beads.has(id)) {
      return backendError("NOT_FOUND", `Bead ${id} not found`);
    }
    let matches = this.deps.filter(
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
    _repoPath?: string,
  ): Promise<BackendResult<void>> {
    if (!this.beads.has(blockerId)) {
      return backendError("NOT_FOUND", `Bead ${blockerId} not found`);
    }
    if (!this.beads.has(blockedId)) {
      return backendError("NOT_FOUND", `Bead ${blockedId} not found`);
    }
    const exists = this.deps.some(
      (d) => d.blockerId === blockerId && d.blockedId === blockedId,
    );
    if (exists) {
      return backendError(
        "ALREADY_EXISTS",
        `Dependency ${blockerId} -> ${blockedId} already exists`,
      );
    }
    this.deps.push({ blockerId, blockedId });
    return { ok: true };
  }

  async removeDependency(
    blockerId: string,
    blockedId: string,
    _repoPath?: string,
  ): Promise<BackendResult<void>> {
    const idx = this.deps.findIndex(
      (d) => d.blockerId === blockerId && d.blockedId === blockedId,
    );
    if (idx === -1) {
      return backendError(
        "NOT_FOUND",
        `Dependency ${blockerId} -> ${blockedId} not found`,
      );
    }
    this.deps.splice(idx, 1);
    return { ok: true };
  }

  // -- Test utilities -------------------------------------------------------

  /** Reset all state (called between tests). */
  reset(): void {
    this.beads.clear();
    this.deps = [];
    resetIdCounter();
  }
}

// ---------------------------------------------------------------------------
// Full capabilities (mock supports everything)
// ---------------------------------------------------------------------------

export const FULL_CAPABILITIES: BackendCapabilities = {
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canClose: true,
  canSearch: true,
  canQuery: true,
  canListReady: true,
  canManageDependencies: true,
  canManageLabels: true,
  canSync: true,
  maxConcurrency: 10,
};

// ---------------------------------------------------------------------------
// Internal helpers (kept below 75 lines each)
// ---------------------------------------------------------------------------

function applyFilters(beads: Bead[], filters?: BeadListFilters): Bead[] {
  if (!filters) return beads;
  return beads.filter((b) => {
    if (filters.type && b.type !== filters.type) return false;
    if (filters.status && b.status !== filters.status) return false;
    if (filters.priority !== undefined && b.priority !== filters.priority)
      return false;
    if (filters.assignee && b.assignee !== filters.assignee) return false;
    return true;
  });
}

function applyUpdate(bead: Bead, input: UpdateBeadInput): void {
  if (input.title !== undefined) bead.title = input.title;
  if (input.description !== undefined) bead.description = input.description;
  if (input.type !== undefined) bead.type = input.type;
  if (input.status !== undefined) bead.status = input.status as BeadStatus;
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
  // Simple "field:value" matching, supports AND with spaces
  const terms = expression.split(/\s+/);
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
      default:
        return true;
    }
  });
}
