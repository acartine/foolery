// ── Backend capability flags ──────────────────────────────────
//
// Declares what operations a backend supports so callers can
// degrade gracefully when a feature is unavailable.

/**
 * Declares what a backend can do.  Each flag maps to a category
 * of operations the caller may attempt.
 */
export interface BackendCapabilities {
  // Core CRUD
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canClose: boolean;

  // Query operations
  canSearch: boolean; // free-text search
  canQuery: boolean; // structured query expressions
  canListReady: boolean; // ready-filtered listing

  // Dependency management
  canManageDependencies: boolean;

  // Label operations (separate from update because some backends
  // handle labels through dedicated commands)
  canManageLabels: boolean;

  // Sync operations
  canSync: boolean;

  // Concurrency constraints (0 = unlimited)
  maxConcurrency: number;
}

// ── Preset capability sets ────────────────────────────────────

/** Everything enabled -- matches the current `bd` CLI backend. */
export const FULL_CAPABILITIES: Readonly<BackendCapabilities> = Object.freeze({
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canClose: true,
  canSearch: true,
  canQuery: true,
  canListReady: true,
  canManageDependencies: true,
  canManageLabels: true,
  canSync: true,
  maxConcurrency: 0,
});

/** Read-only mirror -- no mutations allowed. */
export const READ_ONLY_CAPABILITIES: Readonly<BackendCapabilities> =
  Object.freeze({
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

// ── Guard helpers ─────────────────────────────────────────────

/**
 * Throws if the given capability flag is not enabled.
 *
 * @param capabilities - The backend's capability set.
 * @param flag         - The capability key to check.
 * @param operation    - Human-readable name of the attempted operation
 *                       (used in the error message).
 */
export function assertCapability(
  capabilities: BackendCapabilities,
  flag: keyof BackendCapabilities,
  operation: string,
): void {
  if (!hasCapability(capabilities, flag)) {
    throw new Error(
      `Backend does not support ${operation} (missing capability: ${flag})`,
    );
  }
}

/**
 * Non-throwing check for a single capability flag.
 *
 * Returns `true` when the flag is truthy -- boolean `true` or a
 * number greater than zero.
 */
export function hasCapability(
  capabilities: BackendCapabilities,
  flag: keyof BackendCapabilities,
): boolean {
  const value = capabilities[flag];
  if (typeof value === "boolean") return value;
  // numeric flag (e.g. maxConcurrency): treat > 0 as enabled
  return value > 0;
}
