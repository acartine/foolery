const EXPANDED_PARENTS_KEY = "foolery:expandedParents";

export function getStoredExpandedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(
      EXPANDED_PARENTS_KEY,
    );
    if (!stored) return new Set();
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) return new Set(parsed);
    return new Set();
  } catch {
    return new Set();
  }
}

export function persistExpandedIds(
  ids: Set<string>,
) {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) {
      localStorage.removeItem(EXPANDED_PARENTS_KEY);
    } else {
      localStorage.setItem(
        EXPANDED_PARENTS_KEY,
        JSON.stringify([...ids]),
      );
    }
  } catch {
    /* localStorage unavailable */
  }
}
