/**
 * Stub backend -- minimal read-only BackendPort for incremental migration.
 *
 * Returns empty arrays for read operations and UNAVAILABLE errors for writes.
 * Intended as a safe default when the real backend is not yet wired in.
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
import type { Beat, BeatDependency, MemoryWorkflowDescriptor } from "@/lib/types";
import { builtinWorkflowDescriptors } from "@/lib/workflows";

// ── Capabilities ──────────────────────────────────────────────

export const STUB_CAPABILITIES: Readonly<BackendCapabilities> = Object.freeze({
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  canClose: false,
  canSearch: true,
  canQuery: true,
  canListReady: true,
  canManageDependencies: false,
  canManageLabels: false,
  canSync: false,
  maxConcurrency: 0,
});

// ── Helpers ───────────────────────────────────────────────────

function unavailableError(op: string): BackendResult<never> {
  return {
    ok: false,
    error: {
      code: "UNAVAILABLE",
      message: `Stub backend does not support ${op}`,
      retryable: false,
    },
  };
}

// ── StubBackend ───────────────────────────────────────────────

export class StubBackend implements BackendPort {
  readonly capabilities: BackendCapabilities = STUB_CAPABILITIES;

  async listWorkflows(
    _repoPath?: string,
  ): Promise<BackendResult<MemoryWorkflowDescriptor[]>> {
    return { ok: true, data: builtinWorkflowDescriptors() };
  }

  async list(
    _filters?: BeatListFilters,
    _repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    return { ok: true, data: [] };
  }

  async listReady(
    _filters?: BeatListFilters,
    _repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    return { ok: true, data: [] };
  }

  async search(
    _query: string,
    _filters?: BeatListFilters,
    _repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    return { ok: true, data: [] };
  }

  async query(
    _expression: string,
    _options?: BeatQueryOptions,
    _repoPath?: string,
  ): Promise<BackendResult<Beat[]>> {
    return { ok: true, data: [] };
  }

  async get(
    id: string,
    _repoPath?: string,
  ): Promise<BackendResult<Beat>> {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Beat ${id} not found (stub)`,
        retryable: false,
      },
    };
  }

  async create(
    _input: CreateBeatInput,
    _repoPath?: string,
  ): Promise<BackendResult<{ id: string }>> {
    return unavailableError("create");
  }

  async update(
    _id: string,
    _input: UpdateBeatInput,
    _repoPath?: string,
  ): Promise<BackendResult<void>> {
    return unavailableError("update");
  }

  async delete(
    _id: string,
    _repoPath?: string,
  ): Promise<BackendResult<void>> {
    return unavailableError("delete");
  }

  async close(
    _id: string,
    _reason?: string,
    _repoPath?: string,
  ): Promise<BackendResult<void>> {
    return unavailableError("close");
  }

  async listDependencies(
    _id: string,
    _repoPath?: string,
    _options?: { type?: string },
  ): Promise<BackendResult<BeatDependency[]>> {
    return { ok: true, data: [] };
  }

  async addDependency(
    _blockerId: string,
    _blockedId: string,
    _repoPath?: string,
  ): Promise<BackendResult<void>> {
    return unavailableError("addDependency");
  }

  async removeDependency(
    _blockerId: string,
    _blockedId: string,
    _repoPath?: string,
  ): Promise<BackendResult<void>> {
    return unavailableError("removeDependency");
  }

  async buildTakePrompt(
    _beatId: string,
    _options?: TakePromptOptions,
    _repoPath?: string,
  ): Promise<BackendResult<TakePromptResult>> {
    return unavailableError("buildTakePrompt");
  }

  async buildPollPrompt(
    _options?: PollPromptOptions,
    _repoPath?: string,
  ): Promise<BackendResult<PollPromptResult>> {
    return unavailableError("buildPollPrompt");
  }
}
