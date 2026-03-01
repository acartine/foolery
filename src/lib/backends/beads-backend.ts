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
import type { Beat, BeatDependency, MemoryWorkflowDescriptor } from "@/lib/types";
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
  builtinProfileDescriptor,
  builtinWorkflowDescriptors,
  deriveWorkflowRuntimeState,
  mapStatusToDefaultWorkflowState,
  normalizeStateForWorkflow,
  withWorkflowProfileLabel,
  withWorkflowStateLabel,
} from "@/lib/workflows";

const ACTION_STATES = new Set<string>([
  "planning",
  "plan_review",
  "implementation",
  "implementation_review",
  "shipment",
  "shipment_review",
]);

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
  beads: Map<string, Beat>;
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

function isSupportedProfileSelection(profileId: string | undefined): boolean {
  if (!profileId) return true;
  const normalized = profileId.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "beads-coarse" || normalized === "beads-coarse-human-gated") return true;
  return builtinWorkflowDescriptors().some((workflow) => workflow.id === normalized);
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
    const beads = new Map<string, Beat>();
    for (const raw of rawRecords) {
      const beat = normalizeFromJsonl(raw);
      beads.set(beat.id, beat);
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
    return ok(builtinWorkflowDescriptors());
  }

  // -- Read operations ----------------------------------------------------

  async list(
    filters?: BeatListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    let items = Array.from(entry.beads.values());
    items = applyFilters(items, filters);
    return ok(items);
  }

  async listReady(
    filters?: BeatListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    const blockedIds = new Set(entry.deps.map((d) => d.blockedId));
    let items = Array.from(entry.beads.values()).filter(
      (b) => b.state.startsWith("ready_for_") && !blockedIds.has(b.id) && !b.requiresHumanAction,
    );
    items = applyFilters(items, filters);
    return ok(items);
  }

  async search(
    query: string,
    filters?: BeatListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
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
    _options?: BeatQueryOptions,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
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
  ): Promise<BackendResult<Beat>> {
    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    const beat = entry.beads.get(id);
    if (!beat) return backendError("NOT_FOUND", `Beat ${id} not found`);
    return ok(beat);
  }

  // -- Write operations ---------------------------------------------------

  async create(
    input: CreateBeatInput,
    repoPath?: string,
  ): Promise<BackendResult<{ id: string }>> {
    const selectedProfileId = input.profileId ?? input.workflowId;
    if (!isSupportedProfileSelection(selectedProfileId)) {
      return backendError("INVALID_INPUT", `Unknown profile "${selectedProfileId}" for beads backend`);
    }
    const workflow = builtinProfileDescriptor(selectedProfileId);

    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    const id = generateId();
    const now = isoNow();
    const workflowState = workflow.initialState;
    const runtime = deriveWorkflowRuntimeState(workflow, workflowState);
    const labels = withWorkflowProfileLabel(
      withWorkflowStateLabel(input.labels ?? [], workflowState),
      workflow.id,
    );
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
      labels,
      assignee: input.assignee,
      parent: input.parent,
      due: input.due,
      acceptance: input.acceptance,
      notes: input.notes,
      estimate: input.estimate,
      created: now,
      updated: now,
    };
    entry.beads.set(id, beat);
    await this.flush(rp);
    return ok({ id });
  }

  async update(
    id: string,
    input: UpdateBeatInput,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    if (input.profileId && !isSupportedProfileSelection(input.profileId)) {
      return backendError("INVALID_INPUT", `Unknown profile "${input.profileId}" for beads backend`);
    }
    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    const beat = entry.beads.get(id);
    if (!beat) return backendError("NOT_FOUND", `Beat ${id} not found`);
    applyUpdate(beat, input);
    beat.updated = isoNow();
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
      return backendError("NOT_FOUND", `Beat ${id} not found`);
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
    const beat = entry.beads.get(id);
    if (!beat) return backendError("NOT_FOUND", `Beat ${id} not found`);
    const workflow = builtinProfileDescriptor(beat.profileId ?? beat.workflowId);
    const closedState = mapStatusToDefaultWorkflowState("closed", workflow);
    const runtime = deriveWorkflowRuntimeState(workflow, closedState);
    beat.state = runtime.state;
    beat.nextActionState = runtime.nextActionState;
    beat.nextActionOwnerKind = runtime.nextActionOwnerKind;
    beat.requiresHumanAction = runtime.requiresHumanAction;
    beat.isAgentClaimable = runtime.isAgentClaimable;
    beat.labels = withWorkflowProfileLabel(
      withWorkflowStateLabel(beat.labels ?? [], runtime.state),
      workflow.id,
    );
    beat.closed = isoNow();
    beat.updated = isoNow();
    if (reason) {
      beat.metadata = { ...beat.metadata, close_reason: reason };
    }
    await this.flush(rp);
    return { ok: true };
  }

  // -- Dependency operations ----------------------------------------------

  async listDependencies(
    id: string,
    repoPath?: string,
    options?: { type?: string },
  ): Promise<BackendResult<BeatDependency[]>> {
    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    if (!entry.beads.has(id)) {
      return backendError("NOT_FOUND", `Beat ${id} not found`);
    }
    let matches = entry.deps.filter(
      (d) => d.blockerId === id || d.blockedId === id,
    );
    if (options?.type) {
      matches = matches.filter(() => options.type === "blocks");
    }
    const result: BeatDependency[] = matches.map((d) => ({
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
      return backendError("NOT_FOUND", `Beat ${blockerId} not found`);
    }
    if (!entry.beads.has(blockedId)) {
      return backendError("NOT_FOUND", `Beat ${blockedId} not found`);
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

  async buildTakePrompt(
    beatId: string,
    options?: TakePromptOptions,
    repoPath?: string,
  ): Promise<BackendResult<TakePromptResult>> {
    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    const beat = entry.beads.get(beatId);
    if (!beat) return backendError("NOT_FOUND", `Beat ${beatId} not found`);

    const showCmd = `bd show ${JSON.stringify(beatId)}`;

    if (options?.isParent && options.childBeatIds?.length) {
      const childIds = options.childBeatIds;
      const prompt = [
        `Parent beat ID: ${beatId}`,
        `Use \`${showCmd}\` and \`bd show "<child-id>"\` to inspect full details before starting.`,
        ``,
        `Open child beat IDs:`,
        ...childIds.map((id) => `- ${id}`),
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
    _options?: PollPromptOptions,
    _repoPath?: string,
  ): Promise<BackendResult<PollPromptResult>> {
    return backendError("UNAVAILABLE", "This backend does not support poll-based prompt building");
  }
}

// ── Internal helpers (kept below 75 lines each) ─────────────────

function applyFilters(beats: Beat[], filters?: BeatListFilters): Beat[] {
  if (!filters) return beats;
  return beats.filter((b) => {
    if (filters.workflowId && b.workflowId !== filters.workflowId) return false;
    if (filters.state) {
      if (filters.state === "queued") {
        if (!b.state.startsWith("ready_for_")) return false;
      } else if (filters.state === "in_action") {
        if (!ACTION_STATES.has(b.state)) return false;
      } else {
        if (b.state !== filters.state) return false;
      }
    }
    if (filters.profileId && b.profileId !== filters.profileId) return false;
    if (filters.type && b.type !== filters.type) return false;
    if (filters.requiresHumanAction !== undefined && (b.requiresHumanAction ?? false) !== filters.requiresHumanAction) {
      return false;
    }
    if (filters.nextOwnerKind && b.nextActionOwnerKind !== filters.nextOwnerKind) return false;
    if (filters.priority !== undefined && b.priority !== filters.priority)
      return false;
    if (filters.assignee && b.assignee !== filters.assignee) return false;
    if (filters.label && !b.labels.includes(filters.label)) return false;
    if (filters.owner && b.owner !== filters.owner) return false;
    if (filters.parent && b.parent !== filters.parent) return false;
    return true;
  });
}

function applyUpdate(beat: Beat, input: UpdateBeatInput): void {
  if (input.title !== undefined) beat.title = input.title;
  if (input.description !== undefined) beat.description = input.description;
  if (input.type !== undefined) beat.type = input.type;

  const selectedProfileId = input.profileId ?? beat.profileId ?? beat.workflowId;
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

  beat.labels = withWorkflowProfileLabel(
    withWorkflowStateLabel(beat.labels ?? [], beat.state),
    workflow.id,
  );
}

function matchExpression(beat: Beat, expression: string): boolean {
  const terms = expression.split(/\s+/);
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
  });
}
