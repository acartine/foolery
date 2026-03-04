/** Canonical state used when reopening a beat for regression investigation via ReTake. */
export const RETAKE_TARGET_STATE = "ready_for_implementation" as const;

const RETAKE_SOURCE_STATES = new Set<string>([
  "shipped",
  "closed",
  "done",
  "approved",
]);

export function isRetakeSourceState(state: string | null | undefined): boolean {
  const normalized = state?.trim().toLowerCase();
  if (!normalized) return false;
  return RETAKE_SOURCE_STATES.has(normalized);
}
