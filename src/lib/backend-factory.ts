/**
 * Backend factory -- single composition point for backend creation.
 *
 * All CLI commands, services, and jobs should obtain their BackendPort
 * through this factory (or via the singleton in backend-instance.ts)
 * rather than constructing backends directly.
 */

import type { BackendPort } from "@/lib/backend-port";
import type { BackendCapabilities } from "@/lib/backend-capabilities";
import { BdCliBackend } from "@/lib/backends/bd-cli-backend";
import { StubBackend } from "@/lib/backends/stub-backend";
import { BeadsBackend, BEADS_CAPABILITIES } from "@/lib/backends/beads-backend";

// ── Public types ─────────────────────────────────────────────────

export type BackendType = "cli" | "stub" | "beads";

export interface BackendEntry {
  port: BackendPort;
  capabilities: BackendCapabilities;
}

// ── Factory function ─────────────────────────────────────────────

/**
 * Create a backend by type name.
 * Defaults to "cli" when no type is specified.
 */
export function createBackend(type: BackendType = "cli"): BackendEntry {
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
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown backend type: ${_exhaustive}`);
    }
  }
}
