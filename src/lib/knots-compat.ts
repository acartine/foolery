/**
 * Knots Compatibility Contract & Mapping Specification
 *
 * Single source of truth for all Knots ↔ Foolery mappings, as locked in
 * docs/adr-knots-compatibility.md (ADR scope: foolery-g3y1).
 *
 * These mappings translate between Knots' "simple" / legacy states and
 * Foolery's compat-status categories (open, in_progress, blocked, deferred,
 * closed). Workflow-native states (ready_for_planning, implementation, etc.)
 * pass through the workflow system directly and are NOT covered here.
 */

// ── Knots → Foolery compat-status ──────────────────────────────────────────

/**
 * Maps known Knots simple/legacy states to Foolery compat-status categories.
 *
 * ADR-locked:
 *   idea/work_item            → open
 *   implementing/implemented/reviewing/refining/approved → in_progress
 *   rejected                  → blocked
 *   deferred                  → deferred
 *   shipped/abandoned         → closed
 */
export const KNOTS_TO_FOOLERY_STATUS: ReadonlyMap<string, string> = new Map([
  ["idea", "open"],
  ["work_item", "open"],
  ["implementing", "in_progress"],
  ["implemented", "in_progress"],
  ["reviewing", "in_progress"],
  ["refining", "in_progress"],
  ["approved", "in_progress"],
  ["rejected", "blocked"],
  ["deferred", "deferred"],
  ["shipped", "closed"],
  ["abandoned", "closed"],
]);

// ── Foolery → Knots state ──────────────────────────────────────────────────

/**
 * Maps Foolery compat-status categories to default Knots states.
 *
 * ADR-locked:
 *   open        → work_item
 *   in_progress → implementing
 *   blocked     → rejected
 *   deferred    → deferred
 *   closed      → shipped
 */
export const FOOLERY_TO_KNOTS_STATUS: ReadonlyMap<string, string> = new Map([
  ["open", "work_item"],
  ["in_progress", "implementing"],
  ["blocked", "rejected"],
  ["deferred", "deferred"],
  ["closed", "shipped"],
]);

// ── Mapping functions ──────────────────────────────────────────────────────

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Map a raw Knots state to Foolery's compat-status.
 * Unknown states fall back to "open".
 */
export function mapKnotsStateToFooleryStatus(knotsState: string): string {
  const key = normalize(knotsState);
  if (!key) return "open";
  return KNOTS_TO_FOOLERY_STATUS.get(key) ?? "open";
}

/**
 * Map a Foolery compat-status to the default Knots state.
 * Unknown statuses fall back to "work_item".
 */
export function mapFooleryStatusToKnotsState(fooleryStatus: string): string {
  const key = normalize(fooleryStatus);
  if (!key) return "work_item";
  return FOOLERY_TO_KNOTS_STATUS.get(key) ?? "work_item";
}

// ── Edge / Dependency constants ────────────────────────────────────────────

/** Knots edge kind for blocking dependencies.
 *  addDependency(blocker, blocked) → edge add blocked blocked_by blocker */
export const KNOTS_BLOCKED_BY_EDGE_KIND = "blocked_by" as const;

/** Knots edge kind for parent-child hierarchy. */
export const KNOTS_PARENT_OF_EDGE_KIND = "parent_of" as const;

// ── Close behavior ─────────────────────────────────────────────────────────

/** The Knots state that BackendPort.close() maps to. */
export const KNOTS_CLOSE_TARGET_STATE = "shipped" as const;

// ── Metadata keys ──────────────────────────────────────────────────────────

/** Keys written to Beat.metadata by the Knots backend. */
export const KNOTS_METADATA_KEYS = Object.freeze({
  profileId: "knotsProfileId",
  state: "knotsState",
  profileEtag: "knotsProfileEtag",
  workflowEtag: "knotsWorkflowEtag",
  handoffCapsules: "knotsHandoffCapsules",
  notes: "knotsNotes",
} as const);

// ── Capability flags ───────────────────────────────────────────────────────

/** Knots backend does not support delete. */
export const KNOTS_SUPPORTS_DELETE = false as const;

/** Knots backend supports sync (kno push/pull). */
export const KNOTS_SUPPORTS_SYNC = true as const;
