import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  selectFromPool,
  resolvePoolAgent,
  recordStepAgent,
  getLastStepAgent,
  _resetStepAgentMap,
} from "@/lib/agent-pool";
import type { PoolEntry } from "@/lib/types";
import type { RegisteredAgentConfig, PoolsSettings } from "@/lib/schemas";
import { WorkflowStep } from "@/lib/workflows";

const AGENTS: Record<string, RegisteredAgentConfig> = {
  claude: { command: "claude", model: "opus", label: "Claude Opus" },
  sonnet: { command: "claude", model: "sonnet-4", label: "Claude Sonnet" },
  codex: { command: "codex", model: "5.3", label: "Codex" },
};

describe("selectFromPool", () => {
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

    // Roll near 1.0 should select third (roll = 2.99, after -1 = 1.99, after -1 = 0.99, after -1 = -0.01)
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

  describe("excludeAgentId (cross-agent review)", () => {
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

    it("falls back to excluded agent when no alternatives exist", () => {
      const pool: PoolEntry[] = [{ agentId: "claude", weight: 1 }];
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const result = selectFromPool(pool, AGENTS, "claude");
      expect(result?.agentId).toBe("claude");
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("no eligible alternative"),
      );
      consoleSpy.mockRestore();
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
});

describe("resolvePoolAgent", () => {
  const emptyPools: PoolsSettings = {
    planning: [],
    plan_review: [],
    implementation: [],
    implementation_review: [],
    shipment: [],
    shipment_review: [],
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
