/**
 * Settings tests: agent registration, action agents, step agents,
 * and scope refinement agents.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockChmod = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  chmod: (...args: unknown[]) => mockChmod(...args),
}));

import {
  getRegisteredAgents,
  getOrchestrationAgent,
  getScopeRefinementAgent,
  addRegisteredAgent,
  getAgentRemovalImpact,
  removeRegisteredAgent,
  _resetCache,
} from "@/lib/settings";

beforeEach(() => {
  vi.clearAllMocks();
  _resetCache();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockChmod.mockResolvedValue(undefined);
});

describe("getRegisteredAgents", () => {
  it("returns empty map when no agents configured", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const agents = await getRegisteredAgents();
    expect(agents).toEqual({});
  });

  it("returns agents from TOML", async () => {
    const toml = [
      '[agents.claude]',
      'command = "claude"',
      'label = "Claude Code"',
      'approvalMode = "prompt"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);
    const agents = await getRegisteredAgents();
    expect(agents.claude).toMatchObject({
      command: "claude",
      agent_type: "cli",
      vendor: "claude",
      provider: "Claude",
      agent_name: "Claude",
      label: "Claude",
      approvalMode: "prompt",
    });
  });
});

describe("getScopeRefinementAgent", () => {
  it("uses the scope refinement action mapping in basic mode", async () => {
    const toml = [
      '[agents.codex]', 'command = "codex"', 'label = "Codex"',
      '[actions]', 'scopeRefinement = "codex"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);
    const agent = await getScopeRefinementAgent();
    expect(agent).not.toBeNull();
    expect(agent!.command).toBe("codex");
    expect(agent!.agentId).toBe("codex");
  });

  it("uses the scope refinement pool in advanced mode", async () => {
    const toml = [
      'dispatchMode = "advanced"',
      '[agents.codex]', 'command = "codex"', 'label = "Codex"',
      '[pools]', 'planning = []', 'plan_review = []',
      'implementation = []', 'implementation_review = []',
      'shipment = []', 'shipment_review = []',
      'scope_refinement = [{ agentId = "codex", weight = 1 }]',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);
    const agent = await getScopeRefinementAgent();
    expect(agent).not.toBeNull();
    expect(agent!.command).toBe("codex");
    expect(agent!.agentId).toBe("codex");
  });

  it("returns null when no agent is configured", async () => {
    mockReadFile.mockResolvedValue("");
    const agent = await getScopeRefinementAgent();
    expect(agent).toBeNull();
  });
});

describe("getOrchestrationAgent", () => {
  it("uses the orchestration pool in advanced mode", async () => {
    const toml = [
      'dispatchMode = "advanced"',
      '[agents.codex]', 'command = "codex"', 'label = "Codex"',
      '[[pools.orchestration]]', 'agentId = "codex"', 'weight = 1',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const agent = await getOrchestrationAgent();

    expect(agent.command).toBe("codex");
    expect(agent.agentId).toBe("codex");
  });

  it("falls back to the scene action mapping when no orchestration pool is configured", async () => {
    const toml = [
      '[agents.sonnet]', 'command = "claude"', 'model = "sonnet-4"',
      '[actions]', 'scene = "sonnet"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const agent = await getOrchestrationAgent();

    expect(agent.command).toBe("claude");
    expect(agent.agentId).toBe("sonnet");
    expect(agent.model).toBe("sonnet-4");
  });

  it("applies a model override after agent resolution", async () => {
    const toml = [
      '[agents.sonnet]', 'command = "claude"', 'model = "sonnet-4"',
      '[actions]', 'scene = "sonnet"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const agent = await getOrchestrationAgent("gpt-5.4");

    expect(agent.command).toBe("claude");
    expect(agent.model).toBe("gpt-5.4");
  });

  it("throws FOOLERY DISPATCH FAILURE when no pool and no scene mapping", async () => {
    const toml = [
      'dispatchMode = "advanced"',
      '[agents.claude]', 'command = "claude"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    await expect(getOrchestrationAgent()).rejects.toThrow(
      /FOOLERY DISPATCH FAILURE/,
    );
  });
});

describe("addRegisteredAgent", () => {
  it("adds an agent to the agents map", async () => {
    mockReadFile.mockResolvedValue("");
    const result = await addRegisteredAgent("gemini", {
      command: "gemini", label: "Google Gemini",
    });
    expect(result.agents.gemini).toMatchObject({
      command: "gemini",
      agent_type: "cli",
      vendor: "gemini",
      provider: "Gemini",
      agent_name: "Gemini",
    });
  });
});

describe("removeRegisteredAgent", () => {
  it("removes an agent from the agents map", async () => {
    const toml = [
      '[agents.claude]', 'command = "claude"',
      '[agents.codex]', 'command = "codex"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);
    const result = await removeRegisteredAgent("codex");
    expect(result.agents.codex).toBeUndefined();
    expect(result.agents.claude).toBeDefined();
  });

  it("is a no-op when agent id does not exist", async () => {
    mockReadFile.mockResolvedValue("");
    const result = await removeRegisteredAgent("nonexistent");
    expect(result.agents).toEqual({});
  });
});

describe("removeRegisteredAgent planning", () => {
  it("reports removal impact for actions and pools", async () => {
    const toml = [
      '[agents.claude]', 'command = "claude"',
      '[agents.codex]', 'command = "codex"',
      '[actions]', 'take = "claude"',
      '[[pools.implementation]]', 'agentId = "claude"', 'weight = 1',
      '[[pools.implementation]]', 'agentId = "codex"', 'weight = 1',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const impact = await getAgentRemovalImpact("claude");

    expect(impact.actionUsages).toEqual([
      { action: "take", requiresReplacement: true },
    ]);
    expect(impact.poolUsages).toEqual([
      {
        targetId: "implementation",
        targetLabel: "Implementation",
        targetGroupLabel: "Workflow Pools",
        affectedEntries: 1,
        remainingEntries: 1,
        requiresReplacement: false,
      },
    ]);
    expect(impact.canRemove).toBe(true);
    expect(impact.replacementAgentIds).toEqual(["codex"]);
  });

  it("requires an explicit replacement plan for affected settings", async () => {
    const toml = [
      '[agents.claude]', 'command = "claude"',
      '[agents.codex]', 'command = "codex"',
      '[actions]', 'take = "claude"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    await expect(
      removeRegisteredAgent("claude"),
    ).rejects.toThrow(
      'Action "take" requires a replacement agent',
    );
  });

  it("removes an agent with explicit action and pool decisions", async () => {
    const toml = [
      '[agents.claude]', 'command = "claude"',
      '[agents.codex]', 'command = "codex"',
      '[agents.gemini]', 'command = "gemini"',
      '[actions]', 'take = "claude"',
      '[[pools.implementation]]', 'agentId = "claude"', 'weight = 1',
      '[[pools.implementation]]', 'agentId = "codex"', 'weight = 1',
      '[[pools.plan_review]]', 'agentId = "claude"', 'weight = 1',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const result = await removeRegisteredAgent({
      id: "claude",
      actionReplacements: {
        take: "codex",
      },
      poolDecisions: {
        implementation: { mode: "remove" },
        plan_review: {
          mode: "replace",
          replacementAgentId: "gemini",
        },
      },
    });

    expect(result.agents.claude).toBeUndefined();
    expect(result.actions.take).toBe("codex");
    expect(result.pools.implementation).toEqual([
      { agentId: "codex", weight: 1 },
    ]);
    expect(result.pools.plan_review).toEqual([
      { agentId: "gemini", weight: 1 },
    ]);
  });

  it("blocks removing the last pool entry without replacement", async () => {
    const toml = [
      '[agents.claude]', 'command = "claude"',
      '[agents.codex]', 'command = "codex"',
      '[[pools.plan_review]]', 'agentId = "claude"', 'weight = 1',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    await expect(
      removeRegisteredAgent({
        id: "claude",
        poolDecisions: {
          plan_review: { mode: "remove" },
        },
      }),
    ).rejects.toThrow(
      'Pool "Plan Review" requires a replacement agent',
    );
  });
});
