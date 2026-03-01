/**
 * Singleton access point for the application backend.
 *
 * Lazily creates a backend on first access using the FOOLERY_BACKEND
 * environment variable (defaults to "auto").  Test code can call
 * _resetBackend() to clear the cached instance between runs.
 */

import type { BackendPort } from "@/lib/backend-port";
import type { BackendCapabilities } from "@/lib/backend-capabilities";
import { createBackend, type BackendType } from "@/lib/backend-factory";

let instance: { port: BackendPort; capabilities: BackendCapabilities } | null =
  null;

/**
 * Returns the singleton BackendPort instance.
 * Creates it on first call using the configured backend type.
 */
export function getBackend(): BackendPort {
  if (!instance) {
    const type = (process.env.FOOLERY_BACKEND as BackendType) ?? "auto";
    instance = createBackend(type);
  }
  return instance.port;
}

/**
 * Returns the capabilities of the singleton backend.
 * Initialises the backend if it has not been created yet.
 */
export function getBackendCapabilities(): BackendCapabilities {
  if (!instance) {
    getBackend();
  }
  return instance!.capabilities;
}

interface RepoCapabilityAware {
  capabilitiesForRepo(repoPath?: string): BackendCapabilities;
}

function hasRepoCapabilities(port: BackendPort): port is BackendPort & RepoCapabilityAware {
  return typeof (port as BackendPort & Partial<RepoCapabilityAware>).capabilitiesForRepo === "function";
}

/**
 * Returns the capabilities for a specific repo path.
 * If the backend supports per-repo capability resolution (e.g. AutoRoutingBackend),
 * delegates to it; otherwise falls back to the singleton capabilities.
 */
export function getBackendCapabilitiesForRepo(repoPath?: string): BackendCapabilities {
  const port = getBackend();
  if (hasRepoCapabilities(port)) {
    return port.capabilitiesForRepo(repoPath);
  }
  return getBackendCapabilities();
}

/** Reset the singleton -- intended for test use only. */
export function _resetBackend(): void {
  instance = null;
}
