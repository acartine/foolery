/** BeadsBackend -- BackendPort adapter backed by .beads/issues.jsonl. */

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
  forwardTransitionTarget,
  resolveStep,
  StepPhase,
  withWorkflowStateLabel,
  withWorkflowProfileLabel,
} from "@/lib/workflows";
import {
  applyMarkTerminal,
  applyReopen,
  chooseCloseTarget,
} from "@/lib/backends/beads-backend-correction";
import { getBeatsSkillPrompt } from "@/lib/beats-skill-prompts";
import {
  applyFilters,
  applyUpdate,
  generateId,
  isoNow,
  isSupportedProfileSelection,
  matchExpression,
  normalizeInvariants,
} from "./beads-backend-helpers";
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

function ok<T>(data: T): BackendResult<T> {
  return { ok: true, data };
}

function backendError(
  code: BackendErrorCode,
  message: string,
): BackendResult<never> {
  return { ok: false, error: { code, message, retryable: isRetryableByDefault(code) } };
}

interface DepRecord {
  blockerId: string;
  blockedId: string;
}

interface RepoCache {
  beads: Map<string, Beat>;
  deps: DepRecord[];
  loaded: boolean;
}

export class BeadsBackend implements BackendPort {
  readonly capabilities: BackendCapabilities = BEADS_CAPABILITIES;
  private defaultRepoPath: string;
  private cache = new Map<string, RepoCache>();

  constructor(repoPath?: string) {
    this.defaultRepoPath = repoPath ?? process.cwd();
  }


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

  async listWorkflows(): Promise<BackendResult<MemoryWorkflowDescriptor[]>> {
    return ok(builtinWorkflowDescriptors());
  }


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
      (b) => {
        const beatWorkflow = builtinProfileDescriptor(
          b.profileId ?? b.workflowId,
        );
        return (
          resolveStep(b.state, beatWorkflow)?.phase === StepPhase.Queued &&
          !blockedIds.has(b.id) &&
          !b.requiresHumanAction
        );
      },
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


  async create(
    input: CreateBeatInput,
    repoPath?: string,
  ): Promise<BackendResult<{ id: string }>> {
    const selectedProfileId = input.profileId ?? input.workflowId;
    if (!isSupportedProfileSelection(selectedProfileId)) {
      return backendError(
        "INVALID_INPUT",
        `Unknown profile "${selectedProfileId}" for beads backend`,
      );
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
      invariants: normalizeInvariants(input.invariants),
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
      return backendError(
        "INVALID_INPUT",
        `Unknown profile "${input.profileId}" for beads backend`,
      );
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
    return this.markTerminal(id, chooseCloseTarget(beat), reason, repoPath);
  }

  async markTerminal(
    id: string,
    targetState: string,
    reason?: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    const beat = entry.beads.get(id);
    if (!beat) return backendError("NOT_FOUND", `Beat ${id} not found`);
    applyMarkTerminal(beat, targetState, reason);
    await this.flush(rp);
    return { ok: true };
  }

  async reopen(
    id: string,
    reason?: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    const rp = this.resolvePath(repoPath);
    const entry = await this.ensureLoaded(rp);
    const beat = entry.beads.get(id);
    if (!beat) return backendError("NOT_FOUND", `Beat ${id} not found`);
    applyReopen(beat, reason);
    await this.flush(rp);
    return { ok: true };
  }

  /**
   * Rewind (fat-finger correction) is a knots-backend feature and is
   * not implemented for the legacy beads backend. See
   * `BackendPort.rewind`.
   */
  async rewind(): Promise<BackendResult<void>> {
    return backendError(
      "UNSUPPORTED",
      "Rewind correction is not supported by the Beads backend",
    );
  }

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
      aliases: entry.beads.get(d.blockerId === id ? d.blockedId : d.blockerId)?.aliases,
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

    const beatWorkflow = builtinProfileDescriptor(
      beat.profileId ?? beat.workflowId,
    );
    const shouldClaim =
      resolveStep(beat.state, beatWorkflow)?.phase === StepPhase.Queued &&
      beat.isAgentClaimable;
    if (shouldClaim) {
      const claimResult = await this.claimBeat(beat, rp);
      if (claimResult) {
        const richPrompt = getBeatsSkillPrompt(claimResult.step, beatId, claimResult.target);
        return ok({ prompt: richPrompt, claimed: true });
      }
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
    const rp = this.resolvePath(repoPath);
    const readyResult = await this.listReady(undefined, rp);
    if (!readyResult.ok) return readyResult as BackendResult<never>;

    const claimable = readyResult.data!
      .filter((b) => b.isAgentClaimable)
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

    if (claimable.length === 0) {
      return backendError("NOT_FOUND", "No claimable beats available");
    }

    const beat = claimable[0]!;
    const claimResult = await this.claimBeat(beat, rp);
    if (!claimResult) {
      return backendError("NOT_FOUND", "No claimable beats available");
    }

    const prompt = getBeatsSkillPrompt(claimResult.step, beat.id, claimResult.target);
    return ok({ prompt, claimedId: beat.id });
  }

  private async claimBeat(
    beat: Beat,
    repoPath: string,
  ): Promise<{ target: string; step: string } | null> {
    const profileId = beat.profileId ?? beat.workflowId;
    const workflow = builtinProfileDescriptor(profileId);
    const resolved = resolveStep(beat.state, workflow);
    if (!resolved || resolved.phase !== StepPhase.Queued) return null;
    if (!beat.isAgentClaimable) return null;

    const target = forwardTransitionTarget(beat.state, workflow);
    if (!target) return null;

    const activeResolved = resolveStep(target, workflow);
    if (!activeResolved) return null;

    applyUpdate(beat, { state: target });
    beat.updated = isoNow();
    await this.flush(repoPath);
    return { target, step: activeResolved.step };
  }
}

