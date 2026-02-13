import type { WaveBead, Wave, WavePlan } from "./types";

interface DepEdge {
  source: string; // blocker
  target: string; // blocked
}

export function computeWaves(
  beads: WaveBead[],
  deps: DepEdge[]
): WavePlan {
  const beadMap = new Map(beads.map((b) => [b.id, b]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  for (const b of beads) {
    inDegree.set(b.id, 0);
    adjacency.set(b.id, []);
  }

  // Build graph from deps (only between beads in our set)
  for (const dep of deps) {
    if (!beadMap.has(dep.source) || !beadMap.has(dep.target)) continue;
    adjacency.get(dep.source)!.push(dep.target);
    inDegree.set(dep.target, (inDegree.get(dep.target) ?? 0) + 1);
  }

  // Kahn's algorithm with level tracking
  const levels = new Map<string, number>();
  let queue = beads
    .filter((b) => (inDegree.get(b.id) ?? 0) === 0)
    .map((b) => b.id);

  // Set initial level
  for (const id of queue) {
    levels.set(id, 0);
  }

  const processed = new Set<string>();

  while (queue.length > 0) {
    const nextQueue: string[] = [];
    for (const id of queue) {
      processed.add(id);
      const currentLevel = levels.get(id)!;
      for (const neighbor of adjacency.get(id) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        // Neighbor's level = max of all predecessor levels + 1
        const existingLevel = levels.get(neighbor) ?? 0;
        levels.set(neighbor, Math.max(existingLevel, currentLevel + 1));
        if (newDeg === 0) {
          nextQueue.push(neighbor);
        }
      }
    }
    queue = nextQueue;
  }

  // Group by level
  const waveMap = new Map<number, WaveBead[]>();
  const gateMap = new Map<number, WaveBead>();

  for (const [id, level] of levels) {
    const bead = beadMap.get(id)!;
    if (bead.type === "gate") {
      // Gates guard their wave
      gateMap.set(level, bead);
    } else {
      if (!waveMap.has(level)) waveMap.set(level, []);
      waveMap.get(level)!.push(bead);
    }
  }

  // Build sorted waves
  const maxLevel = Math.max(...Array.from(levels.values()), -1);
  const waves: Wave[] = [];
  for (let i = 0; i <= maxLevel; i++) {
    const waveBeads = waveMap.get(i) ?? [];
    // Sort by priority within wave
    waveBeads.sort((a, b) => a.priority - b.priority);
    waves.push({
      level: i,
      beads: waveBeads,
      gate: gateMap.get(i),
    });
  }

  // Filter out empty waves (only a gate, no beads)
  const filteredWaves = waves.filter((w) => w.beads.length > 0 || w.gate);

  // Unschedulable = circular dependencies (not processed)
  const unschedulable = beads
    .filter((b) => !processed.has(b.id))
    .map((b) => b);

  return {
    waves: filteredWaves,
    unschedulable,
    summary: {
      total: 0,
      runnable: 0,
      inProgress: 0,
      blocked: 0,
      verification: 0,
      gates: 0,
      unschedulable: 0,
    },
    runnableQueue: [],
    computedAt: new Date().toISOString(),
  };
}
