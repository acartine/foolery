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
  getActionAgent,
  getOrchestrationAgent,
  getScopeRefinementAgent,
  addRegisteredAgent,
  getAgentRemovalImpact,
  removeRegisteredAgent,
  getStepAgent,
  _resetCache,
} from "@/lib/settings";
import { WorkflowStep } from "@/lib/workflows";
import { recordStepAgent, _resetStepAgentMap } from "@/lib/agent-pool";

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
      '[agents.claude]', 'command = "claude"', 'label = "Claude Code"',
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
    });
  });
});

describe("getActionAgent", () => {
  it("falls back to first registered agent when mapping is empty", async () => {
    mockReadFile.mockResolvedValue('[agents.claude]\ncommand = "claude"');
    const agent = await getActionAgent("take");
    expect(agent.command).toBe("claude");
  });

  it("falls back to 'claude' when no agents registered", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const agent = await getActionAgent("take");
    expect(agent.command).toBe("claude");
  });

  it("falls back when mapping is legacy 'default'", async () => {
    const toml = ['[actions]', 'take = "default"'].join("\n");
    mockReadFile.mockResolvedValue(toml);
    const agent = await getActionAgent("take");
    expect(agent.command).toBe("claude");
  });

  it("returns registered agent when action is mapped", async () => {
    const toml = [
      '[agents.codex]', 'command = "codex"', 'model = "o3"',
      'label = "OpenAI Codex"',
      '[actions]', 'take = "codex"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);
    const agent = await getActionAgent("take");
    expect(agent.command).toBe("codex");
    expect(agent.model).toBe("o3");
    expect(agent).toMatchObject({
      provider: "Codex",
      agent_name: "Codex",
      lease_model: "o3",
      label: "Codex o3",
    });
  });

  it("preserves provider metadata for mapped agents", async () => {
    const toml = [
      '[agents.glm]', 'command = "/opt/homebrew/bin/opencode"',
      'provider = "OpenCode"',
      'model = "openrouter/z-ai/glm-5"',
      'label = "OpenCode openrouter/z-ai/glm-5"',
      '[actions]', 'take = "glm"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);
    const agent = await getActionAgent("take");
    expect(agent.command).toBe("/opt/homebrew/bin/opencode");
    expect(agent.provider).toBe("OpenCode");
    expect(agent.model).toBe("openrouter/z-ai/glm-5");
  });

  it("falls back when mapped agent id is not registered", async () => {
    const toml = ['[actions]', 'take = "missing"'].join("\n");
    mockReadFile.mockResolvedValue(toml);
    const agent = await getActionAgent("take");
    expect(agent.command).toBe("claude");
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
        step: "implementation",
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
      'Pool "plan_review" requires a replacement agent',
    );
  });
});

describe("getStepAgent: dispatch mode resolution", () => {
  it("uses pool when dispatchMode is advanced and pool is configured", async () => {
    const toml = [
      'dispatchMode = "advanced"',
      '[agents.sonnet]', 'command = "claude"',
      'model = "sonnet-4"', 'label = "Claude Sonnet"',
      '[actions]', 'take = "sonnet"',
      '[[pools.implementation]]', 'agentId = "sonnet"', 'weight = 1',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);
    const agent = await getStepAgent(WorkflowStep.Implementation, "take");
    expect(agent.model).toBe("sonnet-4");
    expect(agent).toMatchObject({
      provider: "Claude",
      agent_name: "Claude",
      lease_model: "sonnet/claude",
      label: "Claude Sonnet 4",
    });
  });

  it("preserves provider metadata for pool-selected agents", async () => {
    const toml = [
      'dispatchMode = "advanced"',
      '[agents.glm]', 'command = "/opt/homebrew/bin/opencode"',
      'provider = "OpenCode"',
      'model = "openrouter/z-ai/glm-5"',
      'label = "OpenCode openrouter/z-ai/glm-5"',
      '[[pools.implementation]]', 'agentId = "glm"', 'weight = 1',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);
    const agent = await getStepAgent(WorkflowStep.Implementation, "take");
    expect(agent.command).toBe("/opt/homebrew/bin/opencode");
    expect(agent.provider).toBe("OpenCode");
    expect(agent.model).toBe("openrouter/z-ai/glm-5");
  });

  it("ignores pool when dispatchMode is basic", async () => {
    const toml = [
      'dispatchMode = "basic"',
      '[agents.sonnet]', 'command = "claude"',
      'model = "sonnet-4"', 'label = "Claude Sonnet"',
      '[agents.opus]', 'command = "claude"',
      'model = "opus"', 'label = "Claude Opus"',
      '[actions]', 'take = "opus"',
      '[[pools.implementation]]', 'agentId = "sonnet"', 'weight = 1',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);
    const agent = await getStepAgent(WorkflowStep.Implementation, "take");
    expect(agent.model).toBe("opus");
    expect(agent.label).toBe("Claude Opus");
  });

  it("falls back to action mapping when pool step is empty", async () => {
    const toml = [
      'dispatchMode = "advanced"',
      '[agents.opus]', 'command = "claude"',
      'model = "opus"', 'label = "Claude Opus"',
      '[actions]', 'take = "opus"',
      '[pools]', 'planning = []', 'implementation = []',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);
    const agent = await getStepAgent(WorkflowStep.Implementation, "take");
    expect(agent.model).toBe("opus");
    expect(agent.label).toBe("Claude Opus");
  });

  it("falls back to dispatch default when no pool and no action mapping", async () => {
    const toml = [
      'dispatchMode = "advanced"',
      '[agents.my-default]', 'command = "my-default"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);
    const agent = await getStepAgent(WorkflowStep.Planning);
    expect(agent.command).toBe("my-default");
  });

  it("defaults dispatchMode to basic when not specified", async () => {
    const toml = [
      '[agents.sonnet]', 'command = "claude"',
      'model = "sonnet-4"', 'label = "Claude Sonnet"',
      '[agents.opus]', 'command = "claude"',
      'model = "opus"', 'label = "Claude Opus"',
      '[actions]', 'take = "opus"',
      '[[pools.implementation]]', 'agentId = "sonnet"', 'weight = 1',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);
    const agent = await getStepAgent(WorkflowStep.Implementation, "take");
    expect(agent.model).toBe("opus");
    expect(agent.label).toBe("Claude Opus");
  });

});

describe("getStepAgent: cross-agent review", () => {
    beforeEach(() => {
      _resetStepAgentMap();
    });

    it("excludes prior action agent when selecting for a review step", async () => {
      const toml = [
        'dispatchMode = "advanced"',
        '[agents.opus]', 'command = "claude"',
        'model = "opus"', 'label = "Claude Opus"',
        '[agents.sonnet]', 'command = "claude"',
        'model = "sonnet-4"', 'label = "Claude Sonnet"',
        '[[pools.implementation]]', 'agentId = "opus"', 'weight = 3',
        '[[pools.implementation_review]]', 'agentId = "opus"', 'weight = 3',
        '[[pools.implementation_review]]', 'agentId = "sonnet"', 'weight = 1',
      ].join("\n");
      mockReadFile.mockResolvedValue(toml);
      recordStepAgent("beat-1", WorkflowStep.Implementation, "opus");
      const agent = await getStepAgent(
        WorkflowStep.ImplementationReview, "take", "beat-1",
      );
      expect(agent.agentId).toBe("sonnet");
      expect(agent.model).toBe("sonnet-4");
    });

    it("does not exclude when no prior agent is recorded", async () => {
      const toml = [
        'dispatchMode = "advanced"',
        '[agents.opus]', 'command = "claude"',
        'model = "opus"', 'label = "Claude Opus"',
        '[[pools.implementation_review]]', 'agentId = "opus"', 'weight = 1',
      ].join("\n");
      mockReadFile.mockResolvedValue(toml);
      const agent = await getStepAgent(
        WorkflowStep.ImplementationReview, "take", "beat-1",
      );
      expect(agent.agentId).toBe("opus");
    });

    it("does not exclude for non-review steps", async () => {
      const toml = [
        'dispatchMode = "advanced"',
        '[agents.opus]', 'command = "claude"',
        'model = "opus"', 'label = "Claude Opus"',
        '[[pools.implementation]]', 'agentId = "opus"', 'weight = 1',
      ].join("\n");
      mockReadFile.mockResolvedValue(toml);
      const agent = await getStepAgent(
        WorkflowStep.Implementation, "take", "beat-1",
      );
      expect(agent.agentId).toBe("opus");
    });
});
