import { describe, expect, it } from "vitest";
import { selectFromPoolStrict, hasAlternativeAgent } from "@/lib/agent-pool";
import type { PoolEntry } from "@/lib/types";
import type { RegisteredAgentConfig, PoolsSettings } from "@/lib/schemas";

const agents: Record<string, RegisteredAgentConfig> = {
  "agent-a": { command: "claude", label: "Claude", model: "opus" },
  "agent-b": { command: "codex", label: "Codex", model: "o4-mini" },
};

const pool: PoolEntry[] = [
  { agentId: "agent-a", weight: 1 },
  { agentId: "agent-b", weight: 1 },
];

const singlePool: PoolEntry[] = [
  { agentId: "agent-a", weight: 1 },
];

describe("selectFromPoolStrict", () => {
  it("returns an alternative agent when one exists", () => {
    const result = selectFromPoolStrict(pool, agents, "agent-a");
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("cli");
    if (result!.kind === "cli") {
      expect(result!.agentId).toBe("agent-b");
    }
  });

  it("returns null when no alternative exists", () => {
    const result = selectFromPoolStrict(singlePool, agents, "agent-a");
    expect(result).toBeNull();
  });

  it("returns null for empty pool", () => {
    const result = selectFromPoolStrict([], agents, "agent-a");
    expect(result).toBeNull();
  });

  it("returns null when excluded agent is the only one with positive weight", () => {
    const mixedPool: PoolEntry[] = [
      { agentId: "agent-a", weight: 1 },
      { agentId: "agent-b", weight: 0 }, // zero weight = excluded
    ];
    const result = selectFromPoolStrict(mixedPool, agents, "agent-a");
    expect(result).toBeNull();
  });
});

describe("hasAlternativeAgent", () => {
  const pools: PoolsSettings = {
    planning: pool,
    plan_review: pool,
    implementation: pool,
    implementation_review: pool,
    shipment: singlePool,
    shipment_review: singlePool,
    scope_refinement: [],
  };

  it("returns true when alternative exists in step pool", () => {
    expect(hasAlternativeAgent("implementation", pools, agents, "agent-a")).toBe(true);
  });

  it("returns false when no alternative exists in step pool", () => {
    expect(hasAlternativeAgent("shipment", pools, agents, "agent-a")).toBe(false);
  });

  it("returns false for empty pools", () => {
    const emptyPools: PoolsSettings = {
      planning: [],
      plan_review: [],
      implementation: [],
      implementation_review: [],
      shipment: [],
      shipment_review: [],
      scope_refinement: [],
    };
    expect(hasAlternativeAgent("implementation", emptyPools, agents, "agent-a")).toBe(false);
  });
});
