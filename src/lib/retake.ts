/** Canonical state used when reopening a beat for regression investigation via ReTake. */
export const RETAKE_TARGET_STATE = "ready_for_implementation" as const;

const RETAKE_SOURCE_STATES = new Set<string>([
  "shipped",
  "closed",
  "done",
  "approved",
]);

/**
 * Knot types that are not eligible for ReTake.
 * Lease, gate, and exploration knots represent infrastructure / review /
 * spike work rather than shippable units, so the Retakes screen excludes
 * them and lists only work-type knots.
 */
const RETAKE_EXCLUDED_KNOT_TYPES = new Set<string>([
  "lease",
  "gate",
  "exploration",
]);

export function isRetakeSourceState(state: string | null | undefined): boolean {
  const normalized = state?.trim().toLowerCase();
  if (!normalized) return false;
  return RETAKE_SOURCE_STATES.has(normalized);
}

export function isRetakeEligibleType(type: string | null | undefined): boolean {
  const normalized = type?.trim().toLowerCase();
  if (!normalized) return true;
  return !RETAKE_EXCLUDED_KNOT_TYPES.has(normalized);
}
