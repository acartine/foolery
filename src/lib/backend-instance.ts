/**
 * Singleton access point for the application backend.
 *
 * Lazily creates a backend on first access using the FOOLERY_BACKEND
 * environment variable (defaults to "cli").  Test code can call
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
    const type = (process.env.FOOLERY_BACKEND as BackendType) ?? "cli";
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

/** Reset the singleton -- intended for test use only. */
export function _resetBackend(): void {
  instance = null;
}
