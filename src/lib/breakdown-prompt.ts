/**
 * Prompt builder and navigation payload for the bead Breakdown → Direct flow.
 *
 * When a user clicks "Breakdown" on a bead detail screen, we:
 *   1. Build a targeted orchestration prompt with `buildBeadBreakdownPrompt`.
 *   2. Stash the prompt + autorun flag in sessionStorage via `setDirectPrefillPayload`.
 *   3. Navigate to the Direct (orchestration) view.
 *   4. The Direct view reads + consumes the payload with `consumeDirectPrefillPayload`.
 */

// ── Prompt builder (foolery-qqla.1.1) ─────────────────────

export function buildBeadBreakdownPrompt(
  beadId: string,
  beadTitle: string,
): string {
  return [
    `Break bead ${beadId} ("${beadTitle}") down into hierarchical tasks,`,
    "making autonomous decisions about execution order, parallel execution,",
    "and vague requirements.",
    "",
    "Focus on this single bead and its potential sub-tasks.",
    "Organize them into dependency-aware scenes that can be executed in waves.",
  ].join(" \n");
}

// ── Navigation payload contract (foolery-qqla.1.2) ────────

export const DIRECT_PREFILL_KEY = "foolery:direct-prefill";

export interface DirectPrefillPayload {
  /** The prompt text to populate in the Direct textarea. */
  prompt: string;
  /** When true, auto-trigger "Plan Scenes" after hydration. */
  autorun: boolean;
  /** The bead ID that triggered this breakdown (for telemetry). */
  sourceBeadId: string;
}

/**
 * Store a Direct-page prefill payload in sessionStorage.
 * Calling this before navigating to `?view=orchestration` causes the
 * Direct view to pick it up on mount.
 */
export function setDirectPrefillPayload(payload: DirectPrefillPayload): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(DIRECT_PREFILL_KEY, JSON.stringify(payload));
}

/**
 * Read and consume the prefill payload (returns null if absent/invalid).
 * Consuming removes the key so it cannot fire twice on re-renders.
 */
export function consumeDirectPrefillPayload(): DirectPrefillPayload | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(DIRECT_PREFILL_KEY);
  if (!raw) return null;
  window.sessionStorage.removeItem(DIRECT_PREFILL_KEY);

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isDirectPrefillPayload(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Type guard for runtime validation of untrusted storage data. */
function isDirectPrefillPayload(value: unknown): value is DirectPrefillPayload {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.prompt === "string" &&
    obj.prompt.length > 0 &&
    typeof obj.autorun === "boolean" &&
    typeof obj.sourceBeadId === "string" &&
    obj.sourceBeadId.length > 0
  );
}
