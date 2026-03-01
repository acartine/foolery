/**
 * BdCliBackend -- BackendPort adapter that delegates to the bd CLI wrapper.
 *
 * Converts BdResult<T> (string error) into BackendResult<T> (structured error)
 * using the error classification helpers from backend-errors.ts.
 */

import type {
  BackendPort,
  BackendResult,
  BeatListFilters,
  BeatQueryOptions,
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
import { beadsProfileWorkflowDescriptors } from "@/lib/workflows";
import * as bd from "@/lib/bd";

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

  async listWorkflows(
    _repoPath?: string,
  ): Promise<BackendResult<MemoryWorkflowDescriptor[]>> {
    return { ok: true, data: beadsProfileWorkflowDescriptors() };
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
        input as Record<string, string | string[] | number | undefined>,
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
        input as Record<string, string | string[] | number | undefined>,
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
    _repoPath?: string,
  ): Promise<BackendResult<TakePromptResult>> {
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
      return { ok: true, data: { prompt, claimed: false } };
    }

    const prompt = [
      `Beat ID: ${beatId}`,
      `Use \`${showCmd}\` to inspect full details before starting.`,
    ].join("\n");
    return { ok: true, data: { prompt, claimed: false } };
  }
}
