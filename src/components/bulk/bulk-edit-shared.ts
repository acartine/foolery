import type { BeatPriority } from "@/lib/types";
import { builtinWorkflowDescriptors, compareWorkflowStatePriority } from "@/lib/workflows";

export type ViewPhase = "queues" | "active";

export const commonTypes: string[] = [
  "bug",
  "feature",
  "task",
  "epic",
  "chore",
  "work",
];

export function formatLabel(val: string): string {
  return val
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Collect the union of either `queueStates` or `actionStates` across
 * all builtin workflow descriptors. State classification is sourced
 * from the loom-derived descriptor, never hardcoded — see CLAUDE.md
 * §"State Classification Is Loom-Derived". Throws loud if descriptors
 * are missing the field, rather than coalescing to a hardcoded default
 * that would silently mask a builtin-catalog regression.
 */
export function collectPhaseStates(phase: ViewPhase): string[] {
  const states = new Set<string>();
  for (const workflow of builtinWorkflowDescriptors()) {
    const phaseStates = phase === "active"
      ? workflow.actionStates
      : workflow.queueStates;
    for (const state of phaseStates ?? []) {
      states.add(state);
    }
  }
  if (states.size === 0) {
    throw new Error(
      `FOOLERY DESCRIPTOR FAILURE: no ${phase} states found across `
      + "builtin workflow descriptors. Caller cannot proceed without "
      + "a loom-derived state list; refusing to fall back to a "
      + "hardcoded default that would mask the regression.",
    );
  }
  return [...states].sort(compareWorkflowStatePriority);
}

/**
 * Bulk-edit "Set state" dropdown options: states a user can move
 * many beats to at once. Sourced from the loom-derived descriptors —
 * union of `terminalStates` plus any wildcard transition targets
 * (e.g. `* -> deferred`). Never hardcoded.
 *
 * @internal Exported for testing only.
 */
export function collectBulkSetStateOptions(): Array<{ value: string; label: string }> {
  const targets = new Set<string>();
  for (const workflow of builtinWorkflowDescriptors()) {
    for (const terminal of workflow.terminalStates ?? []) {
      targets.add(terminal);
    }
    for (const transition of workflow.transitions ?? []) {
      if (transition.from === "*") {
        targets.add(transition.to);
      }
    }
  }
  if (targets.size === 0) {
    throw new Error(
      "FOOLERY DESCRIPTOR FAILURE: no terminal or wildcard-target "
      + "states found across builtin workflow descriptors. Bulk "
      + "Set-state dropdown cannot be populated without a loom-"
      + "derived target list.",
    );
  }
  return [...targets]
    .sort(compareWorkflowStatePriority)
    .map((value) => ({ value, label: formatLabel(value) }));
}

export const QUEUE_STATES = collectPhaseStates("queues");
export const ACTIVE_STATES = collectPhaseStates("active");
export const BULK_SET_STATE_OPTIONS = collectBulkSetStateOptions();

export const MULTISELECT_BUTTON_CLASS =
  "h-8 gap-1.5 px-2.5";
export const MULTISELECT_PRIMARY_CLASS =
  `${MULTISELECT_BUTTON_CLASS} border-primary/25`;
export const MULTISELECT_SUCCESS_CLASS =
  `${MULTISELECT_BUTTON_CLASS} border-accent/35`;

export interface PendingBulkFields {
  type?: string;
  priority?: BeatPriority;
  profileId?: string;
  state?: string;
  labels?: string[];
  removeLabels?: string[];
}

export type PendingSetter = React.Dispatch<
  React.SetStateAction<PendingBulkFields>
>;

/**
 * Normalize a raw label-input string into a label token: trims
 * surrounding whitespace and returns `null` for empty / whitespace-only
 * input so callers can reject it loudly rather than persist a blank
 * label.
 */
export function normalizeLabel(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Add `raw` to `existing` if it is a valid, non-duplicate label.
 * Returns the original array reference unchanged when the input is
 * empty/whitespace-only or already present (case-sensitive), so callers
 * can detect no-ops by identity.
 */
export function addLabel(existing: string[], raw: string): string[] {
  const normalized = normalizeLabel(raw);
  if (normalized === null) return existing;
  if (existing.includes(normalized)) return existing;
  return [...existing, normalized];
}
