import type {
  MemoryWorkflowDescriptor,
} from "@/lib/types";

/**
 * @internal Exported for testing only.
 *
 * State classification (queue/action/terminal) MUST be sourced from
 * the loom-derived `MemoryWorkflowDescriptor` fields — `queueStates`,
 * `actionStates`, `terminalStates` — populated by `toDescriptor` from
 * `kno profile list --json`. Never test for queue/action membership
 * by prefix or hardcoded name. See CLAUDE.md §"State Classification
 * Is Loom-Derived".
 */
export function validNextStates(
  currentState: string | undefined,
  workflow: MemoryWorkflowDescriptor,
  rawKnoState?: string,
): string[] {
  if (!currentState) return [];
  const normalize = (
    state: string | undefined,
  ): string | undefined => {
    const n = state?.trim().toLowerCase();
    if (!n) return undefined;
    const states = workflow.states ?? [];
    if (
      n === "impl"
      && states.includes("implementation")
    ) {
      return "implementation";
    }
    return n;
  };

  const normalized = normalize(currentState);
  if (!normalized) return [];
  const normalizedRaw = normalize(rawKnoState);

  // If the raw kno state differs from the display state, the knot is
  // stuck in an active phase that was rolled back for display. Compute
  // transitions from the actual kno state. Force-required jumps
  // (earlier queue states not in the loom, alternate action states)
  // are NOT surfaced here — those are exception flow and live behind
  // the Rewind submenu in the detail view (and the Correction submenu
  // for terminals). The dropdown only offers transitions kno will
  // accept without `--force`.
  const effective =
    normalizedRaw && normalizedRaw !== normalized
      ? normalizedRaw
      : normalized;

  const next = new Set<string>();
  for (const t of workflow.transitions ?? []) {
    if (
      t.from === effective
      || t.from === "*"
    ) {
      next.add(t.to);
    }
  }

  next.delete(normalized);
  if (normalizedRaw) next.delete(normalizedRaw);

  return Array.from(next);
}
