/**
 * BdCliBackend -- BackendPort adapter that delegates to the bd CLI wrapper.
 *
 * Converts BdResult<T> (string error) into BackendResult<T> (structured error)
 * using the error classification helpers from backend-errors.ts.
 * Prompt-building methods delegate to BeadsBackend for JSONL-based claiming.
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
import { FULL_CAPABILITIES } from "@/lib/backend-capabilities";
import {
  classifyErrorMessage,
  isRetryableByDefault,
} from "@/lib/backend-errors";
import type { CreateBeatInput, UpdateBeatInput } from "@/lib/schemas";
import type { Beat, BeatDependency, MemoryWorkflowDescriptor } from "@/lib/types";
import {
  builtinProfileDescriptor,
  builtinWorkflowDescriptors,
} from "@/lib/workflows";
import { BeadsBackend } from "@/lib/backends/beads-backend";
import * as bd from "@/lib/bd";
import {
  WorkflowCorrectionFailureError,
} from "@/lib/workflow-correction-failure";

// ── BdResult -> BackendResult converter ───────────────────────────

/**
 * Converts a BdResult (plain string error) into a BackendResult
 * (structured BackendError with code, message, retryable).
 */
function toBR<T>(result: {
  ok: boolean;
  data?: T;
  error?: string;
}): BackendResult<T> {
  if (result.ok) {
    return { ok: true, data: result.data };
  }
  const msg = result.error ?? "Unknown error";
  const code = classifyErrorMessage(msg);
  return {
    ok: false,
    error: { code, message: msg, retryable: isRetryableByDefault(code) },
  };
}

// ── Filters cast helper ──────────────────────────────────────────

/** Cast typed BeatListFilters to Record<string, string> for bd.ts functions. */
function filtersToRecord(
  filters?: BeatListFilters,
): Record<string, string> | undefined {
  if (!filters) return undefined;
  const record: Record<string, string> = {};
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== null) {
      record[key] = String(val);
    }
  }
  return Object.keys(record).length > 0 ? record : undefined;
}

// ── BdCliBackend ─────────────────────────────────────────────────

export class BdCliBackend implements BackendPort {
  readonly capabilities: BackendCapabilities = FULL_CAPABILITIES;
  private promptBackend?: BeadsBackend;

  private getPromptBackend(repoPath?: string): BeadsBackend {
    this.promptBackend ??= new BeadsBackend(repoPath);
    return this.promptBackend;
  }

  async listWorkflows(): Promise<BackendResult<MemoryWorkflowDescriptor[]>> {
    return { ok: true, data: builtinWorkflowDescriptors() };
  }

  async list(
    filters?: BeatListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    return toBR(await bd.listBeats(filtersToRecord(filters), repoPath));
  }

  async listReady(
    filters?: BeatListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    return toBR(await bd.readyBeats(filtersToRecord(filters), repoPath));
  }

  async search(
    query: string,
    filters?: BeatListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    return toBR(
      await bd.searchBeats(query, filtersToRecord(filters), repoPath),
    );
  }

  async query(
    expression: string,
    options?: BeatQueryOptions,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    return toBR(await bd.queryBeats(expression, options, repoPath));
  }

  async get(id: string, repoPath?: string): Promise<BackendResult<Beat>> {
    return toBR(await bd.showBeat(id, repoPath));
  }

  async create(
    input: CreateBeatInput,
    repoPath?: string,
  ): Promise<BackendResult<{ id: string }>> {
    return toBR(
      await bd.createBeat(
        input as unknown as Record<string, string | string[] | number | undefined>,
        repoPath,
      ),
    );
  }

  async update(
    id: string,
    input: UpdateBeatInput,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    return toBR(
      await bd.updateBeat(
        id,
        input as unknown as Record<string, string | string[] | number | undefined>,
        repoPath,
      ),
    );
  }

  async delete(id: string, repoPath?: string): Promise<BackendResult<void>> {
    return toBR(await bd.deleteBeat(id, repoPath));
  }

  async close(
    id: string,
    reason?: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    return toBR(await bd.closeBeat(id, reason, repoPath));
  }

  /**
   * bd CLI has no native "skip to terminal" verb; `closeBeat` is the
   * closest analogue. We enforce the descriptive-correction invariant
   * (target must be a terminal of the beat's profile) in the same loud
   * shape as KnotsBackend, then delegate to `closeBeat`. Non-"closed"
   * terminals like `abandoned` are still routed through the same verb
   * because bd has no richer terminal vocabulary.
   */
  async markTerminal(
    id: string,
    targetState: string,
    reason?: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    const workflow = builtinProfileDescriptor();
    const normalizedTarget = targetState.trim().toLowerCase();
    const allowedTerminals = workflow.terminalStates.map(
      (state) => state.trim().toLowerCase(),
    );
    if (!allowedTerminals.includes(normalizedTarget)) {
      throw new WorkflowCorrectionFailureError({
        beatId: id,
        profileId: workflow.id,
        targetState: normalizedTarget,
        allowedTerminals,
        reason: "non_terminal_target",
      });
    }
    return toBR(await bd.closeBeat(id, reason, repoPath));
  }

  /**
   * bd CLI has no native reopen verb; emulate by updating state back
   * to the profile's retakeState. bd validates the transition and may
   * reject; no force flag is available through the CLI boundary.
   */
  async reopen(
    id: string,
    reason?: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    const workflow = builtinProfileDescriptor();
    const update: Record<string, string | string[] | number | undefined> = {
      state: workflow.retakeState,
    };
    if (reason !== undefined) {
      update.notes = `Retake: ${reason}`;
    }
    return toBR(await bd.updateBeat(id, update, repoPath));
  }

  /**
   * Rewind (fat-finger correction) requires kno's `force: true` flag
   * which the bd CLI does not expose. See `BackendPort.rewind`.
   */
  async rewind(): Promise<BackendResult<void>> {
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED",
        message:
          "Rewind correction is not supported by the bd CLI backend "
          + "(no force flag at the CLI boundary)",
        retryable: false,
      },
    };
  }

  async listDependencies(
    id: string,
    repoPath?: string,
    options?: { type?: string },
  ): Promise<BackendResult<BeatDependency[]>> {
    return toBR(await bd.listDeps(id, repoPath, options));
  }

  async addDependency(
    blockerId: string,
    blockedId: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    return toBR(await bd.addDep(blockerId, blockedId, repoPath));
  }

  async removeDependency(
    blockerId: string,
    blockedId: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    return toBR(await bd.removeDep(blockerId, blockedId, repoPath));
  }

  async buildTakePrompt(
    beatId: string,
    options?: TakePromptOptions,
    repoPath?: string,
  ): Promise<BackendResult<TakePromptResult>> {
    return this.getPromptBackend(repoPath).buildTakePrompt(
      beatId,
      options,
      repoPath,
    );
  }

  async buildPollPrompt(
    options?: PollPromptOptions,
    repoPath?: string,
  ): Promise<BackendResult<PollPromptResult>> {
    return this.getPromptBackend(repoPath).buildPollPrompt(options, repoPath);
  }
}
