/**
 * In-memory mock implementation of BackendPort.
 *
 * Serves two purposes:
 *  1. Reference implementation showing how to satisfy the BackendPort contract.
 *  2. Self-test target for the contract test harness.
 */

import type { Beat, BeatDependency, MemoryWorkflowDescriptor } from "@/lib/types";
import type { CreateBeatInput, UpdateBeatInput } from "@/lib/schemas";
import type {
  BackendPort,
  BackendResult,
  BeatListFilters,
  PollPromptOptions,
  PollPromptResult,
  TakePromptOptions,
  TakePromptResult,
} from "@/lib/backend-port";
import type { BackendCapabilities } from "@/lib/backend-capabilities";
import type { BackendErrorCode } from "@/lib/backend-errors";
import {
  builtinProfileDescriptor,
  builtinWorkflowDescriptors,
  deriveWorkflowRuntimeState,
  mapStatusToDefaultWorkflowState,
  withWorkflowProfileLabel,
  withWorkflowStateLabel,
} from "@/lib/workflows";

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

function ignoreUnused(...values: unknown[]): void {
  void values;
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
  private beats = new Map<string, Beat>();
  private deps: DepRecord[] = [];

  async listWorkflows(repoPath?: string): Promise<BackendResult<MemoryWorkflowDescriptor[]>> {
    ignoreUnused(repoPath);
    return ok(builtinWorkflowDescriptors());
  }

  // -- Read operations ------------------------------------------------------

  async list(filters?: BeatListFilters, repoPath?: string): Promise<BackendResult<Beat[]>> {
    ignoreUnused(repoPath);
    let items = Array.from(this.beats.values());
    items = applyFilters(items, filters);
    return ok(items);
  }

  async listReady(
    filters?: BeatListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    ignoreUnused(repoPath);
    let items = Array.from(this.beats.values()).filter(
      (b) => b.state === "open",
    );
    items = applyFilters(items, filters);
    return ok(items);
  }

  async search(
    query: string,
    filters?: BeatListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    ignoreUnused(repoPath);
    const lower = query.toLowerCase();
    let items = Array.from(this.beats.values()).filter(
      (b) =>
        b.id.toLowerCase().includes(lower) ||
        (b.aliases ?? []).some((alias) => alias.toLowerCase().includes(lower)) ||
        b.title.toLowerCase().includes(lower) ||
        (b.description ?? "").toLowerCase().includes(lower),
    );
    items = applyFilters(items, filters);
    return ok(items);
  }

  async query(
    expression: string,
    options?: { limit?: number; sort?: string },
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    ignoreUnused(options, repoPath);
    // Minimal expression support: "state:VALUE" or "type:VALUE"
    const items = Array.from(this.beats.values()).filter((b) =>
      matchExpression(b, expression),
    );
    return ok(items);
  }

  async get(id: string, repoPath?: string): Promise<BackendResult<Beat>> {
    ignoreUnused(repoPath);
    const beat = this.beats.get(id);
    if (!beat) return backendError("NOT_FOUND", `Beat ${id} not found`);
    return ok(beat);
  }

  // -- Write operations -----------------------------------------------------

  async create(
    input: CreateBeatInput,
    repoPath?: string,
  ): Promise<BackendResult<{ id: string }>> {
    ignoreUnused(repoPath);
    const id = nextId();
    const now = isoNow();
    const workflow = builtinProfileDescriptor(input.profileId ?? input.workflowId);
    const workflowState = mapStatusToDefaultWorkflowState("open", workflow);
    const runtime = deriveWorkflowRuntimeState(workflow, workflowState);
    const beat: Beat = {
      id,
      title: input.title,
      description: input.description,
      type: input.type ?? "task",
      state: runtime.state,
      workflowId: workflow.id,
      workflowMode: workflow.mode,
      profileId: workflow.id,
      nextActionState: runtime.nextActionState,
      nextActionOwnerKind: runtime.nextActionOwnerKind,
      requiresHumanAction: runtime.requiresHumanAction,
      isAgentClaimable: runtime.isAgentClaimable,
      priority: input.priority ?? 2,
      labels: withWorkflowProfileLabel(
        withWorkflowStateLabel(input.labels ?? [], workflowState),
        workflow.id,
      ),
      assignee: input.assignee,
      parent: input.parent,
      due: input.due,
      acceptance: input.acceptance,
      notes: input.notes,
      estimate: input.estimate,
      created: now,
      updated: now,
    };
    this.beats.set(id, beat);
    return ok({ id });
  }

  async update(
    id: string,
    input: UpdateBeatInput,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    ignoreUnused(repoPath);
    const beat = this.beats.get(id);
    if (!beat) return backendError("NOT_FOUND", `Beat ${id} not found`);
    applyUpdate(beat, input);
    beat.updated = isoNow();
    return { ok: true };
  }

  async delete(id: string, repoPath?: string): Promise<BackendResult<void>> {
    ignoreUnused(repoPath);
    if (!this.beats.has(id)) {
      return backendError("NOT_FOUND", `Beat ${id} not found`);
    }
    this.beats.delete(id);
    this.deps = this.deps.filter(
      (d) => d.blockerId !== id && d.blockedId !== id,
    );
    return { ok: true };
  }

  async close(
    id: string,
    reason?: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    ignoreUnused(reason, repoPath);
    const beat = this.beats.get(id);
    if (!beat) return backendError("NOT_FOUND", `Beat ${id} not found`);
    const closedWorkflow = builtinProfileDescriptor(beat.profileId ?? beat.workflowId);
    beat.state = mapStatusToDefaultWorkflowState("closed", closedWorkflow);
    beat.closed = isoNow();
    beat.updated = isoNow();
    return { ok: true };
  }

  // -- Dependency operations ------------------------------------------------

  async listDependencies(
    id: string,
    repoPath?: string,
    options?: { type?: string },
  ): Promise<BackendResult<BeatDependency[]>> {
    ignoreUnused(repoPath);
    if (!this.beats.has(id)) {
      return backendError("NOT_FOUND", `Beat ${id} not found`);
    }
    let matches = this.deps.filter(
      (d) => d.blockerId === id || d.blockedId === id,
    );
    if (options?.type) {
      matches = matches.filter(() => options.type === "blocks");
    }
    const result: BeatDependency[] = matches.map((d) => ({
      id: d.blockerId === id ? d.blockedId : d.blockerId,
      aliases: this.beats.get(d.blockerId === id ? d.blockedId : d.blockerId)?.aliases,
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
    ignoreUnused(repoPath);
    if (!this.beats.has(blockerId)) {
      return backendError("NOT_FOUND", `Beat ${blockerId} not found`);
    }
    if (!this.beats.has(blockedId)) {
      return backendError("NOT_FOUND", `Beat ${blockedId} not found`);
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
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    ignoreUnused(repoPath);
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

  async buildTakePrompt(
    beatId: string,
    options?: TakePromptOptions,
    repoPath?: string,
  ): Promise<BackendResult<TakePromptResult>> {
    ignoreUnused(repoPath);
    const beat = this.beats.get(beatId);
    if (!beat) return backendError("NOT_FOUND", `Beat ${beatId} not found`);

    const showCmd = `bd show ${JSON.stringify(beatId)}`;

    if (options?.isParent && options.childBeatIds?.length) {
      const prompt = [
        `Parent beat ID: ${beatId}`,
        `Use \`${showCmd}\` and \`bd show "<child-id>"\` to inspect full details before starting.`,
        ``,
        `Open child beat IDs:`,
        ...options.childBeatIds.map((id) => `- ${id}`),
      ].join("\n");
      return ok({ prompt, claimed: false });
    }

    const prompt = [
      `Beat ID: ${beatId}`,
      `Use \`${showCmd}\` to inspect full details before starting.`,
    ].join("\n");
    return ok({ prompt, claimed: false });
  }

  async buildPollPrompt(
    options?: PollPromptOptions,
    repoPath?: string,
  ): Promise<BackendResult<PollPromptResult>> {
    ignoreUnused(options, repoPath);
    return backendError("UNAVAILABLE", "This backend does not support poll-based prompt building");
  }

  // -- Test utilities -------------------------------------------------------

  /** Reset all state (called between tests). */
  reset(): void {
    this.beats.clear();
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

function applyFilters(beats: Beat[], filters?: BeatListFilters): Beat[] {
  if (!filters) return beats;
  return beats.filter((b) => {
    if (filters.type && b.type !== filters.type) return false;
    if (filters.state && b.state !== filters.state) return false;
    if (filters.priority !== undefined && b.priority !== filters.priority)
      return false;
    if (filters.assignee && b.assignee !== filters.assignee) return false;
    return true;
  });
}

function applyUpdate(beat: Beat, input: UpdateBeatInput): void {
  if (input.title !== undefined) beat.title = input.title;
  if (input.description !== undefined) beat.description = input.description;
  if (input.type !== undefined) beat.type = input.type;
  if (input.state !== undefined) beat.state = input.state;
  if (input.priority !== undefined) beat.priority = input.priority;
  if (input.parent !== undefined) beat.parent = input.parent;
  if (input.labels !== undefined) {
    beat.labels = [...new Set([...beat.labels, ...input.labels])];
  }
  if (input.removeLabels !== undefined) {
    beat.labels = beat.labels.filter((l) => !input.removeLabels!.includes(l));
  }
  if (input.assignee !== undefined) beat.assignee = input.assignee;
  if (input.due !== undefined) beat.due = input.due;
  if (input.acceptance !== undefined) beat.acceptance = input.acceptance;
  if (input.notes !== undefined) beat.notes = input.notes;
  if (input.estimate !== undefined) beat.estimate = input.estimate;
}

function matchExpression(beat: Beat, expression: string): boolean {
  // Simple "field:value" matching, supports AND with spaces
  const terms = expression.split(/\s+/);
  return terms.every((term) => {
    const [field, value] = term.split(":");
    if (!field || !value) return true;
    switch (field) {
      case "state":
        return beat.state === value;
      case "type":
        return beat.type === value;
      case "priority":
        return String(beat.priority) === value;
      case "assignee":
        return beat.assignee === value;
      default:
        return true;
    }
  });
}
