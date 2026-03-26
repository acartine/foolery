import type {
  MemoryWorkflowDescriptor,
} from "@/lib/types";

/** @internal Exported for testing only. */
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
  const isQueued =
    normalized.startsWith("ready_for_");
  const normalizedRaw = normalize(rawKnoState);

  const isRolledBack = Boolean(
    normalizedRaw
      && normalizedRaw !== normalized,
  );
  const effective =
    isRolledBack && normalizedRaw
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

  const statesList = workflow.states ?? [];
  const idx = statesList.indexOf(effective);
  if (idx > 0) {
    for (let i = 0; i < idx; i++) {
      const earlier = statesList[i];
      if (earlier?.startsWith("ready_for_")) {
        next.add(earlier);
      }
    }
  }

  if (isRolledBack) {
    for (const s of workflow.states ?? []) {
      if (
        !workflow.terminalStates?.includes(s)
      ) {
        next.add(s);
      }
    }
  }

  next.delete(normalized);
  if (normalizedRaw) next.delete(normalizedRaw);

  if (isRolledBack || !isQueued) {
    return Array.from(next);
  }
  return Array.from(next).filter(
    (s) => !s.startsWith("ready_for_"),
  );
}
