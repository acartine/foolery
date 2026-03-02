import { describe, it, expect, vi, beforeEach } from "vitest";
import { selectFromPool, resolvePoolAgent } from "@/lib/agent-pool";
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
      command: "claude",
      model: "opus",
      label: "Claude Opus",
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

    // Roll at ~0.5 should select second (roll = 1.5, after -1 = 0.5, after -1 = -0.5)
    randomSpy.mockReturnValue(0.5);
    result = selectFromPool(pool, AGENTS);
    expect(result?.label).toBe("Claude Sonnet");

    // Roll near 1.0 should select third (roll = 2.99, after -1 = 1.99, after -1 = 0.99, after -1 = -0.01)
    randomSpy.mockReturnValue(0.999);
    result = selectFromPool(pool, AGENTS);
    expect(result?.label).toBe("Codex");

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
      command: "claude",
      model: "sonnet-4",
      label: "Claude Sonnet",
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
});
