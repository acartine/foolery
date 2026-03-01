import type { WaveBeat, Wave, WavePlan } from "./types";

interface DepEdge {
  source: string; // blocker
  target: string; // blocked
}

export function computeWaves(
  beats: WaveBeat[],
  deps: DepEdge[]
): WavePlan {
  const beatMap = new Map(beats.map((b) => [b.id, b]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  for (const b of beats) {
    inDegree.set(b.id, 0);
    adjacency.set(b.id, []);
  }

  // Build graph from deps (only between beats in our set)
  for (const dep of deps) {
    if (!beatMap.has(dep.source) || !beatMap.has(dep.target)) continue;
    adjacency.get(dep.source)!.push(dep.target);
    inDegree.set(dep.target, (inDegree.get(dep.target) ?? 0) + 1);
  }

  // Kahn's algorithm with level tracking
  const levels = new Map<string, number>();
  let queue = beats
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
  const waveMap = new Map<number, WaveBeat[]>();
  const gateMap = new Map<number, WaveBeat>();

  for (const [id, level] of levels) {
    const beat = beatMap.get(id)!;
    if (beat.type === "gate") {
      // Gates guard their wave
      gateMap.set(level, beat);
    } else {
      if (!waveMap.has(level)) waveMap.set(level, []);
      waveMap.get(level)!.push(beat);
    }
  }

  // Build sorted waves
  const maxLevel = Math.max(...Array.from(levels.values()), -1);
  const waves: Wave[] = [];
  for (let i = 0; i <= maxLevel; i++) {
    const waveBeats = waveMap.get(i) ?? [];
    // Sort by priority within wave
    waveBeats.sort((a, b) => a.priority - b.priority);
    waves.push({
      level: i,
      beats: waveBeats,
      gate: gateMap.get(i),
    });
  }

  // Filter out empty waves (only a gate, no beats)
  const filteredWaves = waves.filter((w) => w.beats.length > 0 || w.gate);

  // Unschedulable = circular dependencies (not processed)
  const unschedulable = beats
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
