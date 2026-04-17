/**
 * Knots backend constants: edge kinds, metadata keys, and capability flags.
 *
 * This file used to host Knots↔Foolery status mapping helpers. Those have
 * been removed — Foolery code now speaks workflow-native states directly.
 * What remains are plain backend constants that are not a translation layer.
 */

/** Knots edge kind for blocking dependencies.
 *  addDependency(blocker, blocked) → edge add blocked blocked_by blocker */
export const KNOTS_BLOCKED_BY_EDGE_KIND = "blocked_by" as const;

/** Knots edge kind for parent-child hierarchy. */
export const KNOTS_PARENT_OF_EDGE_KIND = "parent_of" as const;

/** The Knots state that BackendPort.close() maps to. */
export const KNOTS_CLOSE_TARGET_STATE = "shipped" as const;

/** Keys written to Beat.metadata by the Knots backend. */
export const KNOTS_METADATA_KEYS = Object.freeze({
  profileId: "knotsProfileId",
  state: "knotsState",
  profileEtag: "knotsProfileEtag",
  workflowEtag: "knotsWorkflowEtag",
  handoffCapsules: "knotsHandoffCapsules",
  notes: "knotsNotes",
} as const);

/** Knots backend does not support delete. */
export const KNOTS_SUPPORTS_DELETE = false as const;

/** Knots backend supports sync (kno push/pull). */
export const KNOTS_SUPPORTS_SYNC = true as const;
