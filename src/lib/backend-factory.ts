/**
 * Backend factory -- single composition point for backend creation.
 *
 * All CLI commands, services, and jobs should obtain their BackendPort
 * through this factory (or via the singleton in backend-instance.ts)
 * rather than constructing backends directly.
 */

import type { BackendPort } from "@/lib/backend-port";
import type { BackendCapabilities } from "@/lib/backend-capabilities";
import { FULL_CAPABILITIES } from "@/lib/backend-capabilities";
import { BdCliBackend } from "@/lib/backends/bd-cli-backend";
import { StubBackend } from "@/lib/backends/stub-backend";
import { BeadsBackend, BEADS_CAPABILITIES } from "@/lib/backends/beads-backend";
import { KnotsBackend, KNOTS_CAPABILITIES } from "@/lib/backends/knots-backend";
import { detectMemoryManagerType } from "@/lib/memory-manager-detection";

// ── Public types ─────────────────────────────────────────────────

export type BackendType = "auto" | "cli" | "stub" | "beads" | "knots";

export interface BackendEntry {
  port: BackendPort;
  capabilities: BackendCapabilities;
}

class AutoRoutingBackend implements BackendPort {
  private cache = new Map<Exclude<BackendType, "auto">, BackendEntry>();
  private fallbackType: Exclude<BackendType, "auto">;

  constructor(fallbackType: Exclude<BackendType, "auto"> = "cli") {
    this.fallbackType = fallbackType;
  }

  private resolveType(repoPath?: string): Exclude<BackendType, "auto"> {
    if (!repoPath) return this.fallbackType;
    const memoryManager = detectMemoryManagerType(repoPath);
    if (memoryManager === "knots") return "knots";
    if (memoryManager === "beads") return "cli";
    return this.fallbackType;
  }

  private getBackend(type: Exclude<BackendType, "auto">): BackendEntry {
    const existing = this.cache.get(type);
    if (existing) return existing;
    const next = createConcreteBackend(type);
    this.cache.set(type, next);
    return next;
  }

  private backendFor(repoPath?: string): BackendPort {
    const type = this.resolveType(repoPath);
    return this.getBackend(type).port;
  }

  async listWorkflows(...args: Parameters<BackendPort["listWorkflows"]>): ReturnType<BackendPort["listWorkflows"]> {
    return this.backendFor(args[0]).listWorkflows(...args);
  }

  async list(...args: Parameters<BackendPort["list"]>): ReturnType<BackendPort["list"]> {
    return this.backendFor(args[1]).list(...args);
  }

  async listReady(...args: Parameters<BackendPort["listReady"]>): ReturnType<BackendPort["listReady"]> {
    return this.backendFor(args[1]).listReady(...args);
  }

  async search(...args: Parameters<BackendPort["search"]>): ReturnType<BackendPort["search"]> {
    return this.backendFor(args[2]).search(...args);
  }

  async query(...args: Parameters<BackendPort["query"]>): ReturnType<BackendPort["query"]> {
    return this.backendFor(args[2]).query(...args);
  }

  async get(...args: Parameters<BackendPort["get"]>): ReturnType<BackendPort["get"]> {
    return this.backendFor(args[1]).get(...args);
  }

  async create(...args: Parameters<BackendPort["create"]>): ReturnType<BackendPort["create"]> {
    return this.backendFor(args[1]).create(...args);
  }

  async update(...args: Parameters<BackendPort["update"]>): ReturnType<BackendPort["update"]> {
    return this.backendFor(args[2]).update(...args);
  }

  async delete(...args: Parameters<BackendPort["delete"]>): ReturnType<BackendPort["delete"]> {
    return this.backendFor(args[1]).delete(...args);
  }

  async close(...args: Parameters<BackendPort["close"]>): ReturnType<BackendPort["close"]> {
    return this.backendFor(args[2]).close(...args);
  }

  async listDependencies(
    ...args: Parameters<BackendPort["listDependencies"]>
  ): ReturnType<BackendPort["listDependencies"]> {
    return this.backendFor(args[1]).listDependencies(...args);
  }

  async addDependency(...args: Parameters<BackendPort["addDependency"]>): ReturnType<BackendPort["addDependency"]> {
    return this.backendFor(args[2]).addDependency(...args);
  }

  async removeDependency(
    ...args: Parameters<BackendPort["removeDependency"]>
  ): ReturnType<BackendPort["removeDependency"]> {
    return this.backendFor(args[2]).removeDependency(...args);
  }

  async buildTakePrompt(
    ...args: Parameters<BackendPort["buildTakePrompt"]>
  ): ReturnType<BackendPort["buildTakePrompt"]> {
    return this.backendFor(args[2]).buildTakePrompt(...args);
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
      const backend = new AutoRoutingBackend("cli");
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
