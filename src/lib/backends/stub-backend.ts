/**
 * Stub backend -- minimal read-only BackendPort for incremental migration.
 *
 * Returns empty arrays for read operations and UNAVAILABLE errors for writes.
 * Intended as a safe default when the real backend is not yet wired in.
 */

import type {
  BackendPort,
  BackendResult,
  PollPromptResult,
  TakePromptResult,
} from "@/lib/backend-port";
import type { BackendCapabilities } from "@/lib/backend-capabilities";
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

  async listWorkflows(): Promise<BackendResult<MemoryWorkflowDescriptor[]>> {
    return { ok: true, data: builtinWorkflowDescriptors() };
  }

  async list(): Promise<BackendResult<Beat[]>> {
    return { ok: true, data: [] };
  }

  async listReady(): Promise<BackendResult<Beat[]>> {
    return { ok: true, data: [] };
  }

  async search(): Promise<BackendResult<Beat[]>> {
    return { ok: true, data: [] };
  }

  async query(): Promise<BackendResult<Beat[]>> {
    return { ok: true, data: [] };
  }

  async get(
    id: string,
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

  async create(): Promise<BackendResult<{ id: string }>> {
    return unavailableError("create");
  }

  async update(): Promise<BackendResult<void>> {
    return unavailableError("update");
  }

  async delete(): Promise<BackendResult<void>> {
    return unavailableError("delete");
  }

  async close(): Promise<BackendResult<void>> {
    return unavailableError("close");
  }

  async listDependencies(): Promise<BackendResult<BeatDependency[]>> {
    return { ok: true, data: [] };
  }

  async addDependency(): Promise<BackendResult<void>> {
    return unavailableError("addDependency");
  }

  async removeDependency(): Promise<BackendResult<void>> {
    return unavailableError("removeDependency");
  }

  async buildTakePrompt(): Promise<BackendResult<TakePromptResult>> {
    return unavailableError("buildTakePrompt");
  }

  async buildPollPrompt(): Promise<BackendResult<PollPromptResult>> {
    return unavailableError("buildPollPrompt");
  }
}
