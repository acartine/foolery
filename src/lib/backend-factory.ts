/**
 * Backend factory -- single composition point for backend creation.
 *
 * All CLI commands, services, and jobs should obtain their BackendPort
 * through this factory (or via the singleton in backend-instance.ts)
 * rather than constructing backends directly.
 *
 * The auto-routing backend resolves a concrete backend from a repo path's
 * memory-manager marker (`.knots/`, `.beads/`). If the path is missing or
 * unrecognised, it throws a `DispatchFailureError` with a red `FOOLERY
 * DISPATCH FAILURE` banner. There is no silent fallback; callers that want
 * to bypass detection must select an explicit backend via
 * `FOOLERY_BACKEND=cli|knots|beads|stub`. See CLAUDE.md §"Fail Loudly,
 * Never Silently".
 */

import type { BackendPort, BackendResult } from "@/lib/backend-port";
import type { BackendCapabilities } from "@/lib/backend-capabilities";
import { FULL_CAPABILITIES } from "@/lib/backend-capabilities";
import { BdCliBackend } from "@/lib/backends/bd-cli-backend";
import { StubBackend } from "@/lib/backends/stub-backend";
import { BeadsBackend, BEADS_CAPABILITIES } from "@/lib/backends/beads-backend";
import { KnotsBackend, KNOTS_CAPABILITIES } from "@/lib/backends/knots-backend";
import { detectMemoryManagerType } from "@/lib/memory-manager-detection";
import { DispatchFailureError } from "@/lib/dispatch-pool-resolver";
import { builtinWorkflowDescriptors } from "@/lib/workflows";
import type { MemoryWorkflowDescriptor } from "@/lib/types";

// ── Public types ─────────────────────────────────────────────────

export type BackendType = "auto" | "cli" | "stub" | "beads" | "knots";

export interface BackendEntry {
  port: BackendPort;
  capabilities: BackendCapabilities;
}

export class AutoRoutingBackend implements BackendPort {
  private cache = new Map<Exclude<BackendType, "auto">, BackendEntry>();
  private repoTypeCache = new Map<string, { type: Exclude<BackendType, "auto">; cachedAt: number }>();
  private REPO_CACHE_TTL_MS = 30_000;

  /**
   * Resolve the concrete backend type for a given repo path.
   *
   * Throws `DispatchFailureError` when `repoPath` is missing or when no
   * memory-manager marker is found at the path. There is intentionally no
   * fallback to a default backend — silent fallbacks previously surfaced
   * downstream as misleading storage errors (e.g., `table not found:
   * issues`) instead of pointing at the real configuration gap.
   */
  private resolveType(method: string, repoPath?: string): Exclude<BackendType, "auto"> {
    if (!repoPath) {
      throw new DispatchFailureError({
        kind: "backend",
        repoPath: null,
        method,
        reason: "repo_path_missing",
      });
    }

    const cached = this.repoTypeCache.get(repoPath);
    if (cached && Date.now() - cached.cachedAt < this.REPO_CACHE_TTL_MS) {
      return cached.type;
    }

    const memoryManager = detectMemoryManagerType(repoPath);
    let resolved: Exclude<BackendType, "auto">;
    if (memoryManager === "knots") resolved = "knots";
    else if (memoryManager === "beads") resolved = "cli";
    else {
      throw new DispatchFailureError({
        kind: "backend",
        repoPath,
        method,
        reason: "repo_type_unknown",
      });
    }

    this.repoTypeCache.set(repoPath, { type: resolved, cachedAt: Date.now() });
    return resolved;
  }

  clearRepoCache(repoPath?: string): void {
    if (repoPath) {
      this.repoTypeCache.delete(repoPath);
    } else {
      this.repoTypeCache.clear();
    }
  }

  /**
   * Capability lookup is advisory: UI surfaces call this to decide whether
   * to show buttons. Treat resolution failure as "all capabilities
   * available" so render paths don't crash on a no-repo or unknown-repo
   * surface; the data path still throws when actually called.
   */
  capabilitiesForRepo(repoPath?: string): BackendCapabilities {
    try {
      const type = this.resolveType("capabilitiesForRepo", repoPath);
      return this.getBackend(type).capabilities;
    } catch (err) {
      if (err instanceof DispatchFailureError) {
        return FULL_CAPABILITIES;
      }
      throw err;
    }
  }

  private getBackend(type: Exclude<BackendType, "auto">): BackendEntry {
    const existing = this.cache.get(type);
    if (existing) return existing;
    const next = createConcreteBackend(type);
    this.cache.set(type, next);
    return next;
  }

  private backendFor(method: string, repoPath?: string): BackendPort {
    const type = this.resolveType(method, repoPath);
    return this.getBackend(type).port;
  }

  async listWorkflows(
    ...args: Parameters<BackendPort["listWorkflows"]>
  ): Promise<BackendResult<MemoryWorkflowDescriptor[]>> {
    const repoPath = args[0];
    if (!repoPath) {
      return { ok: true, data: builtinWorkflowDescriptors() };
    }
    return this.backendFor("listWorkflows", repoPath).listWorkflows(...args);
  }

  async list(...args: Parameters<BackendPort["list"]>): ReturnType<BackendPort["list"]> {
    return this.backendFor("list", args[1]).list(...args);
  }

  async listReady(...args: Parameters<BackendPort["listReady"]>): ReturnType<BackendPort["listReady"]> {
    return this.backendFor("listReady", args[1]).listReady(...args);
  }

  async search(...args: Parameters<BackendPort["search"]>): ReturnType<BackendPort["search"]> {
    return this.backendFor("search", args[2]).search(...args);
  }

  async query(...args: Parameters<BackendPort["query"]>): ReturnType<BackendPort["query"]> {
    return this.backendFor("query", args[2]).query(...args);
  }

  async get(...args: Parameters<BackendPort["get"]>): ReturnType<BackendPort["get"]> {
    return this.backendFor("get", args[1]).get(...args);
  }

  async create(...args: Parameters<BackendPort["create"]>): ReturnType<BackendPort["create"]> {
    return this.backendFor("create", args[1]).create(...args);
  }

  async update(...args: Parameters<BackendPort["update"]>): ReturnType<BackendPort["update"]> {
    return this.backendFor("update", args[2]).update(...args);
  }

  async delete(...args: Parameters<BackendPort["delete"]>): ReturnType<BackendPort["delete"]> {
    return this.backendFor("delete", args[1]).delete(...args);
  }

  async close(...args: Parameters<BackendPort["close"]>): ReturnType<BackendPort["close"]> {
    return this.backendFor("close", args[2]).close(...args);
  }

  async markTerminal(
    ...args: Parameters<BackendPort["markTerminal"]>
  ): ReturnType<BackendPort["markTerminal"]> {
    return this.backendFor("markTerminal", args[3]).markTerminal(...args);
  }

  async reopen(
    ...args: Parameters<BackendPort["reopen"]>
  ): ReturnType<BackendPort["reopen"]> {
    return this.backendFor("reopen", args[2]).reopen(...args);
  }

  async rewind(
    ...args: Parameters<BackendPort["rewind"]>
  ): ReturnType<BackendPort["rewind"]> {
    return this.backendFor("rewind", args[3]).rewind(...args);
  }

  async listDependencies(
    ...args: Parameters<BackendPort["listDependencies"]>
  ): ReturnType<BackendPort["listDependencies"]> {
    return this.backendFor("listDependencies", args[1]).listDependencies(...args);
  }

  async addDependency(...args: Parameters<BackendPort["addDependency"]>): ReturnType<BackendPort["addDependency"]> {
    return this.backendFor("addDependency", args[2]).addDependency(...args);
  }

  async removeDependency(
    ...args: Parameters<BackendPort["removeDependency"]>
  ): ReturnType<BackendPort["removeDependency"]> {
    return this.backendFor("removeDependency", args[2]).removeDependency(...args);
  }

  async buildTakePrompt(
    ...args: Parameters<BackendPort["buildTakePrompt"]>
  ): ReturnType<BackendPort["buildTakePrompt"]> {
    return this.backendFor("buildTakePrompt", args[2]).buildTakePrompt(...args);
  }

  async buildPollPrompt(
    ...args: Parameters<BackendPort["buildPollPrompt"]>
  ): ReturnType<BackendPort["buildPollPrompt"]> {
    return this.backendFor("buildPollPrompt", args[1]).buildPollPrompt(...args);
  }
}

function createConcreteBackend(type: Exclude<BackendType, "auto">): BackendEntry {
  switch (type) {
    case "cli": {
      const backend = new BdCliBackend();
      return { port: backend, capabilities: backend.capabilities };
    }
    case "stub": {
      const backend = new StubBackend();
      return { port: backend, capabilities: backend.capabilities };
    }
    case "beads": {
      const backend = new BeadsBackend();
      return { port: backend, capabilities: BEADS_CAPABILITIES };
    }
    case "knots": {
      const backend = new KnotsBackend();
      return { port: backend, capabilities: KNOTS_CAPABILITIES };
    }
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown backend type: ${_exhaustive}`);
    }
  }
}

// ── Factory function ─────────────────────────────────────────────

/**
 * Create a backend by type name.
 * Defaults to "auto" when no type is specified.
 */
export function createBackend(type: BackendType = "auto"): BackendEntry {
  switch (type) {
    case "auto": {
      const backend = new AutoRoutingBackend();
      return { port: backend, capabilities: FULL_CAPABILITIES };
    }
    case "cli":
    case "stub":
    case "beads":
    case "knots":
      return createConcreteBackend(type);
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown backend type: ${_exhaustive}`);
    }
  }
}
