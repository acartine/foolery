import type { Bead } from "@/lib/types";

/**
 * Keep only beads whose entire parent chain exists in the same dataset.
 * This prevents ready descendants from surfacing as top-level rows when an
 * intermediate ancestor is excluded (for example: blocked/not-ready parent).
 */
export function filterByVisibleAncestorChain(beads: Bead[]): Bead[] {
  const byId = new Map(beads.map((bead) => [bead.id, bead]));
  const cache = new Map<string, boolean>();
  const visiting = new Set<string>();

  function hasVisibleChain(bead: Bead): boolean {
    if (cache.has(bead.id)) return cache.get(bead.id) ?? false;
    if (visiting.has(bead.id)) {
      cache.set(bead.id, false);
      return false;
    }

    visiting.add(bead.id);
    let visible = true;

    if (bead.parent) {
      const parent = byId.get(bead.parent);
      visible = parent ? hasVisibleChain(parent) : false;
    }

    visiting.delete(bead.id);
    cache.set(bead.id, visible);
    return visible;
  }

  return beads.filter((bead) => hasVisibleChain(bead));
}
