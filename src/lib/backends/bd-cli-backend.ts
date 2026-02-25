/**
 * BdCliBackend -- BackendPort adapter that delegates to the bd CLI wrapper.
 *
 * Converts BdResult<T> (string error) into BackendResult<T> (structured error)
 * using the error classification helpers from backend-errors.ts.
 */

import type {
  BackendPort,
  BackendResult,
  BeadListFilters,
  BeadQueryOptions,
} from "@/lib/backend-port";
import type { BackendCapabilities } from "@/lib/backend-capabilities";
import { FULL_CAPABILITIES } from "@/lib/backend-capabilities";
import {
  classifyErrorMessage,
  isRetryableByDefault,
} from "@/lib/backend-errors";
import type { CreateBeadInput, UpdateBeadInput } from "@/lib/schemas";
import type { Bead, BeadDependency, MemoryWorkflowDescriptor } from "@/lib/types";
import { beadsCoarseWorkflowDescriptor } from "@/lib/workflows";
import * as bd from "@/lib/bd";

// ── BdResult -> BackendResult converter ───────────────────────────

/**
 * Converts a BdResult<T> (plain string error) into a BackendResult<T>
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

/** Cast typed BeadListFilters to Record<string, string> for bd.ts functions. */
function filtersToRecord(
  filters?: BeadListFilters,
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
    return { ok: true, data: [beadsCoarseWorkflowDescriptor()] };
  }

  async list(
    filters?: BeadListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Bead[]>> {
    return toBR(await bd.listBeads(filtersToRecord(filters), repoPath));
  }

  async listReady(
    filters?: BeadListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Bead[]>> {
    return toBR(await bd.readyBeads(filtersToRecord(filters), repoPath));
  }

  async search(
    query: string,
    filters?: BeadListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Bead[]>> {
    return toBR(
      await bd.searchBeads(query, filtersToRecord(filters), repoPath),
    );
  }

  async query(
    expression: string,
    options?: BeadQueryOptions,
    repoPath?: string,
  ): Promise<BackendResult<Bead[]>> {
    return toBR(await bd.queryBeads(expression, options, repoPath));
  }

  async get(id: string, repoPath?: string): Promise<BackendResult<Bead>> {
    return toBR(await bd.showBead(id, repoPath));
  }

  async create(
    input: CreateBeadInput,
    repoPath?: string,
  ): Promise<BackendResult<{ id: string }>> {
    return toBR(
      await bd.createBead(
        input as Record<string, string | string[] | number | undefined>,
        repoPath,
      ),
    );
  }

  async update(
    id: string,
    input: UpdateBeadInput,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    return toBR(
      await bd.updateBead(
        id,
        input as Record<string, string | string[] | number | undefined>,
        repoPath,
      ),
    );
  }

  async delete(id: string, repoPath?: string): Promise<BackendResult<void>> {
    return toBR(await bd.deleteBead(id, repoPath));
  }

  async close(
    id: string,
    reason?: string,
    repoPath?: string,
  ): Promise<BackendResult<void>> {
    return toBR(await bd.closeBead(id, reason, repoPath));
  }

  async listDependencies(
    id: string,
    repoPath?: string,
    options?: { type?: string },
  ): Promise<BackendResult<BeadDependency[]>> {
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
}
