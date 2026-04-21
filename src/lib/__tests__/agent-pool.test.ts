import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  countDispatchAgentOccurrences,
  selectFromPool,
  resolvePoolAgent,
  recordStepAgent,
  getLastStepAgent,
  _resetStepAgentMap,
  getSwappableSourceAgentIds,
  swapActionsAgent,
  swapPoolAgent,
  swapPoolsAgent,
} from "@/lib/agent-pool";
import type { PoolEntry } from "@/lib/types";
import type {
  ActionAgentMappings,
  RegisteredAgentConfig,
  PoolsSettings,
} from "@/lib/schemas";
import { WorkflowStep } from "@/lib/workflows";

const AGENTS: Record<string, RegisteredAgentConfig> = {
  claude: { command: "claude", model: "opus", label: "Claude Opus" },
  sonnet: { command: "claude", model: "sonnet-4", label: "Claude Sonnet" },
  codex: { command: "codex", model: "5.3", label: "Codex" },
};

describe("selectFromPool: basic selection", () => {
    it("returns null for empty pool", () => {
    expect(selectFromPool([], AGENTS)).toBeNull();
  });

  it("returns null when no agents match pool entries", () => {
    const pool: PoolEntry[] = [{ agentId: "nonexistent", weight: 1 }];
    expect(selectFromPool(pool, AGENTS)).toBeNull();
  });

  it("returns null when all weights are zero", () => {
    const pool: PoolEntry[] = [
      { agentId: "claude", weight: 0 },
      { agentId: "sonnet", weight: 0 },
    ];
    expect(selectFromPool(pool, AGENTS)).toBeNull();
  });

  it("returns the only agent when pool has one entry", () => {
    const pool: PoolEntry[] = [{ agentId: "claude", weight: 1 }];
    const result = selectFromPool(pool, AGENTS);
    expect(result).toEqual({
      kind: "cli",
      command: "claude",
      model: "opus",
      label: "Claude Opus",
      agentId: "claude",
    });
  });

  it("returns agents according to weight distribution", () => {
    const pool: PoolEntry[] = [
      { agentId: "claude", weight: 100 },
      { agentId: "sonnet", weight: 0 },
    ];
    // With sonnet at weight 0, only claude should be selected
    const result = selectFromPool(pool, AGENTS);
    expect(result?.model).toBe("opus");
    expect(result?.agentId).toBe("claude");
  });

  it("respects weighted random selection", () => {
    const pool: PoolEntry[] = [
      { agentId: "claude", weight: 1 },
      { agentId: "sonnet", weight: 1 },
      { agentId: "codex", weight: 1 },
    ];

    // Mock Math.random to control selection
    const randomSpy = vi.spyOn(Math, "random");

    // With equal weights (total=3), roll near 0 should select first
    randomSpy.mockReturnValue(0.0);
    let result = selectFromPool(pool, AGENTS);
    expect(result?.label).toBe("Claude Opus");
    expect(result?.agentId).toBe("claude");

    // Roll at ~0.5 should select second (roll = 1.5, after -1 = 0.5, after -1 = -0.5)
    randomSpy.mockReturnValue(0.5);
    result = selectFromPool(pool, AGENTS);
    expect(result?.label).toBe("Claude Sonnet");
    expect(result?.agentId).toBe("sonnet");

    // Roll near 1.0 should select third
    // (roll = 2.99, after -1 = 1.99, -1 = 0.99, -1 = -0.01)
    randomSpy.mockReturnValue(0.999);
    result = selectFromPool(pool, AGENTS);
    expect(result?.label).toBe("Codex");
    expect(result?.agentId).toBe("codex");

    randomSpy.mockRestore();
  });

  it("skips entries referencing non-existent agents", () => {
    const pool: PoolEntry[] = [
      { agentId: "nonexistent", weight: 10 },
      { agentId: "claude", weight: 1 },
    ];
    // Only claude exists, so it should always be selected
    const result = selectFromPool(pool, AGENTS);
    expect(result?.label).toBe("Claude Opus");
  });

});

describe("selectFromPool: excludeAgentId", () => {
    it("excludes the specified agent and selects from alternatives", () => {
      const pool: PoolEntry[] = [
        { agentId: "claude", weight: 3 },
        { agentId: "sonnet", weight: 1 },
      ];
      // Exclude claude — only sonnet should be selected
      const result = selectFromPool(pool, AGENTS, "claude");
      expect(result?.agentId).toBe("sonnet");
      expect(result?.label).toBe("Claude Sonnet");
    });

    it("returns null when no alternatives exist", () => {
      const pool: PoolEntry[] = [{ agentId: "claude", weight: 1 }];
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const result = selectFromPool(pool, AGENTS, "claude");
      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("No eligible alternative"),
      );
      consoleSpy.mockRestore();
    });

    it("returns null when every agent is excluded by failure history", () => {
      const pool: PoolEntry[] = [
        { agentId: "claude", weight: 1 },
        { agentId: "sonnet", weight: 1 },
      ];
      const result = selectFromPool(
        pool,
        AGENTS,
        new Set(["claude", "sonnet"]),
      );
      expect(result).toBeNull();
    });

    it("respects weights among remaining alternatives", () => {
      const pool: PoolEntry[] = [
        { agentId: "claude", weight: 100 },
        { agentId: "sonnet", weight: 3 },
        { agentId: "codex", weight: 1 },
      ];
      const randomSpy = vi.spyOn(Math, "random");

      // Exclude claude. Remaining: sonnet(3) + codex(1) = total 4
      // Roll 0.0 → 0.0 * 4 = 0.0, first entry (sonnet) selected
      randomSpy.mockReturnValue(0.0);
      let result = selectFromPool(pool, AGENTS, "claude");
      expect(result?.agentId).toBe("sonnet");

      // Roll 0.9 → 0.9 * 4 = 3.6, after -3 = 0.6, after -1 = -0.4 → codex
      randomSpy.mockReturnValue(0.9);
      result = selectFromPool(pool, AGENTS, "claude");
      expect(result?.agentId).toBe("codex");

      randomSpy.mockRestore();
    });

    it("ignores exclusion when excludeAgentId is not in the pool", () => {
      const pool: PoolEntry[] = [
        { agentId: "claude", weight: 1 },
        { agentId: "sonnet", weight: 1 },
      ];
      // Exclude "codex" which is not in this pool — no effect
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.0);
      const result = selectFromPool(pool, AGENTS, "codex");
      expect(result?.agentId).toBe("claude");
      randomSpy.mockRestore();
    });
});

describe("resolvePoolAgent", () => {
  const emptyPools: PoolsSettings = {
    orchestration: [],
    planning: [],
    plan_review: [],
    implementation: [],
    implementation_review: [],
    shipment: [],
    shipment_review: [],
    scope_refinement: [],
  };

  it("returns null when no pool is configured for step", () => {
    const result = resolvePoolAgent(
      WorkflowStep.Implementation,
      emptyPools,
      AGENTS,
    );
    expect(result).toBeNull();
  });

  it("selects from configured pool", () => {
    const pools: PoolsSettings = {
      ...emptyPools,
      implementation: [{ agentId: "sonnet", weight: 1 }],
    };
    const result = resolvePoolAgent(
      WorkflowStep.Implementation,
      pools,
      AGENTS,
    );
    expect(result).toEqual({
      kind: "cli",
      command: "claude",
      model: "sonnet-4",
      label: "Claude Sonnet",
      agentId: "sonnet",
    });
  });

  it("returns null for unconfigured step even if others have pools", () => {
    const pools: PoolsSettings = {
      ...emptyPools,
      implementation: [{ agentId: "sonnet", weight: 1 }],
    };
    const result = resolvePoolAgent(
      WorkflowStep.Planning,
      pools,
      AGENTS,
    );
    expect(result).toBeNull();
  });

  it("passes excludeAgentId through to selectFromPool", () => {
    const pools: PoolsSettings = {
      ...emptyPools,
      implementation_review: [
        { agentId: "claude", weight: 3 },
        { agentId: "sonnet", weight: 1 },
      ],
    };
    // Exclude claude for review — should select sonnet
    const result = resolvePoolAgent(
      WorkflowStep.ImplementationReview,
      pools,
      AGENTS,
      "claude",
    );
    expect(result?.agentId).toBe("sonnet");
  });
});

describe("step agent tracking", () => {
  beforeEach(() => {
    _resetStepAgentMap();
  });

  it("records and retrieves agent for a beat+step", () => {
    recordStepAgent("beat-1", WorkflowStep.Implementation, "claude");
    expect(getLastStepAgent("beat-1", WorkflowStep.Implementation)).toBe(
      "claude",
    );
  });

  it("returns undefined for untracked beat+step", () => {
    expect(
      getLastStepAgent("beat-1", WorkflowStep.Implementation),
    ).toBeUndefined();
  });

  it("tracks different agents for different steps of the same beat", () => {
    recordStepAgent("beat-1", WorkflowStep.Planning, "sonnet");
    recordStepAgent("beat-1", WorkflowStep.Implementation, "claude");
    expect(getLastStepAgent("beat-1", WorkflowStep.Planning)).toBe("sonnet");
    expect(getLastStepAgent("beat-1", WorkflowStep.Implementation)).toBe(
      "claude",
    );
  });

  it("tracks different agents for different beats", () => {
    recordStepAgent("beat-1", WorkflowStep.Implementation, "claude");
    recordStepAgent("beat-2", WorkflowStep.Implementation, "sonnet");
    expect(getLastStepAgent("beat-1", WorkflowStep.Implementation)).toBe(
      "claude",
    );
    expect(getLastStepAgent("beat-2", WorkflowStep.Implementation)).toBe(
      "sonnet",
    );
  });

  it("overwrites previous agent on re-record", () => {
    recordStepAgent("beat-1", WorkflowStep.Implementation, "claude");
    recordStepAgent("beat-1", WorkflowStep.Implementation, "sonnet");
    expect(getLastStepAgent("beat-1", WorkflowStep.Implementation)).toBe(
      "sonnet",
    );
  });
});

describe("swapPoolAgent", () => {
  it("swaps an existing pool agent while preserving weight and order", () => {
    const pool: PoolEntry[] = [
      { agentId: "claude", weight: 2 },
      { agentId: "sonnet", weight: 1 },
    ];
    const swapped = swapPoolAgent(pool, "claude", "codex");
    expect(swapped).toEqual([
      { agentId: "codex", weight: 2 },
      { agentId: "sonnet", weight: 1 },
    ]);
  });

  it("returns the original entries when source agent is missing", () => {
    const pool: PoolEntry[] = [{ agentId: "claude", weight: 2 }];
    const swapped = swapPoolAgent(pool, "codex", "sonnet");
    expect(swapped).toBe(pool);
  });

  it("returns the original entries for no-op swaps", () => {
    const pool: PoolEntry[] = [{ agentId: "claude", weight: 2 }];
    const swapped = swapPoolAgent(pool, "claude", "claude");
    expect(swapped).toBe(pool);
  });

  it("merges weights when replacement already exists in pool", () => {
    const pool: PoolEntry[] = [
      { agentId: "claude", weight: 2 },
      { agentId: "sonnet", weight: 1 },
    ];
    const swapped = swapPoolAgent(pool, "claude", "sonnet");
    expect(swapped).toEqual([{ agentId: "sonnet", weight: 3 }]);
  });

  it("merges into existing replacement and preserves other entries order", () => {
    const pool: PoolEntry[] = [
      { agentId: "sonnet", weight: 1 },
      { agentId: "claude", weight: 2 },
      { agentId: "codex", weight: 3 },
    ];
    const swapped = swapPoolAgent(pool, "codex", "sonnet");
    expect(swapped).toEqual([
      { agentId: "sonnet", weight: 4 },
      { agentId: "claude", weight: 2 },
    ]);
  });

  it("replaces all source occurrences when replacement is missing", () => {
    const pool: PoolEntry[] = [
      { agentId: "claude", weight: 2 },
      { agentId: "sonnet", weight: 1 },
      { agentId: "claude", weight: 3 },
    ];
    const swapped = swapPoolAgent(pool, "claude", "codex");
    expect(swapped).toEqual([
      { agentId: "codex", weight: 5 },
      { agentId: "sonnet", weight: 1 },
    ]);
  });

  it("replaces all source occurrences and merges into existing replacement", () => {
    const pool: PoolEntry[] = [
      { agentId: "sonnet", weight: 1 },
      { agentId: "claude", weight: 2 },
      { agentId: "codex", weight: 3 },
      { agentId: "claude", weight: 4 },
    ];
    const swapped = swapPoolAgent(pool, "claude", "codex");
    expect(swapped).toEqual([
      { agentId: "sonnet", weight: 1 },
      { agentId: "codex", weight: 9 },
    ]);
  });
});

describe("getSwappableSourceAgentIds", () => {
  it("returns no options when there are no available agents", () => {
    expect(getSwappableSourceAgentIds(["claude"], [])).toEqual([]);
  });

  it("returns no options when all used agents equal the only available agent", () => {
    expect(getSwappableSourceAgentIds(["claude"], ["claude"])).toEqual([]);
  });

  it("keeps stale source ids when a single replacement agent exists", () => {
    expect(getSwappableSourceAgentIds(["legacy"], ["claude"])).toEqual([
      "legacy",
    ]);
  });

  it("keeps each source that has at least one different replacement", () => {
    expect(
      getSwappableSourceAgentIds(["claude", "codex"], ["claude", "codex"]),
    ).toEqual(["claude", "codex"]);
  });
});

describe("swapActionsAgent", () => {
  const baseActions: ActionAgentMappings = {
    take: "claude",
    scene: "sonnet",
    scopeRefinement: "claude",
  };

  it("swaps the source agent across all mapped actions", () => {
    const result = swapActionsAgent(baseActions, "claude", "codex");
    expect(result.affectedActions).toBe(2);
    expect(result.updates).toEqual({
      take: "codex",
      scopeRefinement: "codex",
    });
    expect(result.updatedActions).toEqual({
      take: "codex",
      scene: "sonnet",
      scopeRefinement: "codex",
    });
  });

  it("returns original mappings when source agent is missing", () => {
    const result = swapActionsAgent(baseActions, "nonexistent", "codex");
    expect(result.affectedActions).toBe(0);
    expect(result.updates).toEqual({});
    expect(result.updatedActions).toBe(baseActions);
  });

  it("returns original mappings for no-op swaps", () => {
    const result = swapActionsAgent(baseActions, "claude", "claude");
    expect(result.affectedActions).toBe(0);
    expect(result.updates).toEqual({});
    expect(result.updatedActions).toBe(baseActions);
  });
});

describe("countDispatchAgentOccurrences", () => {
  const actions: ActionAgentMappings = {
    take: "claude",
    scene: "sonnet",
    scopeRefinement: "claude",
  };

  const pools: PoolsSettings = {
    orchestration: [],
    planning: [{ agentId: "claude", weight: 1 }],
    plan_review: [],
    implementation: [
      { agentId: "sonnet", weight: 2 },
      { agentId: "claude", weight: 3 },
      { agentId: "claude", weight: 4 },
    ],
    implementation_review: [{ agentId: "codex", weight: 1 }],
    shipment: [],
    shipment_review: [{ agentId: "claude", weight: 2 }],
    scope_refinement: [{ agentId: "claude", weight: 1 }],
  };

  it("counts global action and pool occurrences for a source agent", () => {
    expect(countDispatchAgentOccurrences(actions, pools, "claude")).toEqual({
      affectedActions: 2,
      affectedEntries: 5,
      affectedSteps: 4,
    });
  });

  it("returns zero counts when the source agent is absent", () => {
    expect(countDispatchAgentOccurrences(actions, pools, "legacy")).toEqual({
      affectedActions: 0,
      affectedEntries: 0,
      affectedSteps: 0,
    });
  });
});

describe("swapPoolsAgent", () => {
  const basePools: PoolsSettings = {
    orchestration: [],
    planning: [{ agentId: "claude", weight: 1 }],
    plan_review: [],
    implementation: [
      { agentId: "sonnet", weight: 2 },
      { agentId: "claude", weight: 3 },
    ],
    implementation_review: [{ agentId: "claude", weight: 4 }],
    shipment: [{ agentId: "codex", weight: 1 }],
    shipment_review: [],
    scope_refinement: [{ agentId: "claude", weight: 5 }],
  };

  it("swaps the source agent across all workflow steps that contain it", () => {
    const result = swapPoolsAgent(basePools, "claude", "codex");
    expect(result.affectedEntries).toBe(4);
    expect(result.affectedSteps).toBe(4);
    expect(result.updates).toEqual({
      planning: [{ agentId: "codex", weight: 1 }],
      implementation: [
        { agentId: "sonnet", weight: 2 },
        { agentId: "codex", weight: 3 },
      ],
      implementation_review: [{ agentId: "codex", weight: 4 }],
      scope_refinement: [{ agentId: "codex", weight: 5 }],
    });
    expect(result.updatedPools).toEqual({
      orchestration: [],
      planning: [{ agentId: "codex", weight: 1 }],
      plan_review: [],
      implementation: [{ agentId: "sonnet", weight: 2 }, { agentId: "codex", weight: 3 }],
      implementation_review: [{ agentId: "codex", weight: 4 }],
      shipment: [{ agentId: "codex", weight: 1 }],
      shipment_review: [],
      scope_refinement: [{ agentId: "codex", weight: 5 }],
    });
  });

  it("returns original pools when no steps contain the source agent", () => {
    const result = swapPoolsAgent(basePools, "nonexistent", "codex");
    expect(result.affectedEntries).toBe(0);
    expect(result.affectedSteps).toBe(0);
    expect(result.updates).toEqual({});
    expect(result.updatedPools).toBe(basePools);
  });

  it("returns original pools for no-op swaps", () => {
    const result = swapPoolsAgent(basePools, "claude", "claude");
    expect(result.affectedEntries).toBe(0);
    expect(result.affectedSteps).toBe(0);
    expect(result.updates).toEqual({});
    expect(result.updatedPools).toBe(basePools);
  });

  it("counts every matching pool entry across steps, not just affected steps", () => {
    const pools: PoolsSettings = {
      orchestration: [],
      planning: [
        { agentId: "claude", weight: 1 },
        { agentId: "claude", weight: 2 },
      ],
      plan_review: [],
      implementation: [
        { agentId: "sonnet", weight: 2 },
        { agentId: "claude", weight: 3 },
      ],
      implementation_review: [],
      shipment: [{ agentId: "codex", weight: 1 }],
      shipment_review: [{ agentId: "claude", weight: 4 }],
      scope_refinement: [{ agentId: "claude", weight: 5 }],
    };

    const result = swapPoolsAgent(pools, "claude", "codex");

    expect(result.affectedEntries).toBe(5);
    expect(result.affectedSteps).toBe(4);
    expect(result.updatedPools).toEqual({
      orchestration: [],
      planning: [{ agentId: "codex", weight: 3 }],
      plan_review: [],
      implementation: [{ agentId: "sonnet", weight: 2 }, { agentId: "codex", weight: 3 }],
      implementation_review: [],
      shipment: [{ agentId: "codex", weight: 1 }],
      shipment_review: [{ agentId: "codex", weight: 4 }],
      scope_refinement: [{ agentId: "codex", weight: 5 }],
    });
  });
});
