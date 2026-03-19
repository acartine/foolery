import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:fs/promises before importing the module under test
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
  loadSettings,
  saveSettings,
  getAgentCommand,
  updateSettings,
  inspectSettingsDefaults,
  inspectStaleSettingsKeys,
  backfillMissingSettingsDefaults,
  cleanStaleSettingsKeys,
  getRegisteredAgents,
  getActionAgent,
  addRegisteredAgent,
  removeRegisteredAgent,
  getStepAgent,
  _resetCache,
} from "@/lib/settings";
import { WorkflowStep } from "@/lib/workflows";
import { recordStepAgent, _resetStepAgentMap } from "@/lib/agent-pool";

const DEFAULT_ACTIONS = {
  take: "",
  scene: "",
  breakdown: "",
};

const DEFAULT_POOLS = {
  planning: [],
  plan_review: [],
  implementation: [],
  implementation_review: [],
  shipment: [],
  shipment_review: [],
};

const DEFAULT_SETTINGS = {
  agents: {},
  actions: DEFAULT_ACTIONS,
  backend: { type: "auto" },
  defaults: { profileId: "" },
  pools: DEFAULT_POOLS,
  dispatchMode: "basic",
  maxConcurrentSessions: 5,
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetCache();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockChmod.mockResolvedValue(undefined);
});

describe("loadSettings", () => {
  it("returns defaults when no file exists", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const settings = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it("parses valid TOML with registered agents", async () => {
    mockReadFile.mockResolvedValue('[agents.claude]\ncommand = "claude"\nlabel = "Claude"');
    const settings = await loadSettings();
    expect(settings.agents.claude.command).toBe("claude");
  });

  it("falls back to defaults on invalid TOML", async () => {
    mockReadFile.mockResolvedValue("{{{{not valid toml");
    const settings = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it("fills in defaults for missing keys", async () => {
    mockReadFile.mockResolvedValue('[actions]\ntake = ""');
    const settings = await loadSettings();
    expect(settings.actions.scene).toBe("");
  });

  it("normalizes legacy dispatch mode values on read", async () => {
    mockReadFile.mockResolvedValue('dispatchMode = "actions"');
    const settings = await loadSettings();
    expect(settings.dispatchMode).toBe("basic");
  });

  it("uses cache within TTL", async () => {
    mockReadFile.mockResolvedValue('[agents.claude]\ncommand = "claude"');
    await loadSettings();
    await loadSettings();
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });
});

describe("inspectSettingsDefaults", () => {
  it("reports missing default keys for partial files", async () => {
    mockReadFile.mockResolvedValue('[actions]\ntake = ""');
    const result = await inspectSettingsDefaults();
    expect(result.fileMissing).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.missingPaths).toContain("defaults.profileId");
  });
});

describe("inspectStaleSettingsKeys", () => {
  it("reports obsolete v0.3.0 settings keys", async () => {
    mockReadFile.mockResolvedValue(
      [
        '[agent]',
        'command = "claude"',
        '[verification]',
        'enabled = true',
        '[actions]',
        'direct = "codex"',
      ].join("\n"),
    );

    const result = await inspectStaleSettingsKeys();
    expect(result.fileMissing).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.stalePaths).toEqual(["agent", "verification", "actions.direct"]);
  });
});

describe("backfillMissingSettingsDefaults", () => {
  it("creates settings.toml with defaults when file is missing", async () => {
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockReadFile.mockRejectedValue(err);
    const result = await backfillMissingSettingsDefaults();
    expect(result.changed).toBe(true);
    expect(result.fileMissing).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("[defaults]");
    expect(written).toContain('profileId = ""');
    expect(mockChmod).toHaveBeenCalledWith(
      expect.stringContaining("settings.toml"),
      0o600,
    );
  });

  it("writes missing defaults without clobbering existing values", async () => {
    mockReadFile.mockResolvedValue('[agents.codex]\ncommand = "codex"');
    const result = await backfillMissingSettingsDefaults();
    expect(result.changed).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain('command = "codex"');
    expect(written).toContain("[defaults]");
  });

  it("rewrites legacy dispatch mode values to canonical ones when backfilling", async () => {
    mockReadFile.mockResolvedValue('dispatchMode = "pools"');
    const result = await backfillMissingSettingsDefaults();
    expect(result.changed).toBe(true);
    expect(result.settings.dispatchMode).toBe("advanced");

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain('dispatchMode = "advanced"');
    expect(written).not.toContain('dispatchMode = "pools"');
  });

  it("does not write when defaults are already present", async () => {
    mockReadFile.mockResolvedValue(
      [
        'dispatchMode = "basic"',
        'maxConcurrentSessions = 5',
        '[actions]',
        'take = ""',
        'scene = ""',
        'breakdown = ""',
        '[backend]',
        'type = "cli"',
        '[defaults]',
        'profileId = ""',
        '[pools]',
        'planning = []',
        'plan_review = []',
        'implementation = []',
        'implementation_review = []',
        'shipment = []',
        'shipment_review = []',
      ].join("\n"),
    );
    const result = await backfillMissingSettingsDefaults();
    expect(result.changed).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

describe("cleanStaleSettingsKeys", () => {
  it("removes obsolete settings keys without touching active ones", async () => {
    mockReadFile.mockResolvedValue(
      [
        'dispatchMode = "basic"',
        '[agent]',
        'command = "claude"',
        '[verification]',
        'enabled = true',
        '[actions]',
        'take = "claude"',
        'direct = "codex"',
      ].join("\n"),
    );

    const result = await cleanStaleSettingsKeys();
    expect(result.changed).toBe(true);
    expect(result.stalePaths).toEqual(["agent", "verification", "actions.direct"]);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("[actions]");
    expect(written).toContain('take = "claude"');
    expect(written).not.toContain("[agent]");
    expect(written).not.toContain("[verification]");
    expect(written).not.toContain('direct = "codex"');
  });

  it("does not write when no stale keys are present", async () => {
    mockReadFile.mockResolvedValue('[actions]\ntake = "claude"');

    const result = await cleanStaleSettingsKeys();
    expect(result.changed).toBe(false);
    expect(result.stalePaths).toEqual([]);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

describe("saveSettings", () => {
  it("writes valid TOML that round-trips", async () => {
    const settings = {
      agents: { "my-agent": { command: "my-agent" } },
      actions: DEFAULT_ACTIONS,
      backend: { type: "auto" as const },
      defaults: { profileId: "" },
      pools: { planning: [], plan_review: [], implementation: [], implementation_review: [], shipment: [], shipment_review: [] },
      dispatchMode: "basic" as const,
      maxConcurrentSessions: 5,
    };
    await saveSettings(settings);
    expect(mockMkdir).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledTimes(1);

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("my-agent");
  });

  it("sets file permissions to 0600 after writing", async () => {
    const settings = {
      agents: {},
      actions: DEFAULT_ACTIONS,
      backend: { type: "auto" as const },
      defaults: { profileId: "" },
      pools: DEFAULT_POOLS,
      dispatchMode: "basic" as const,
      maxConcurrentSessions: 5,
    };
    await saveSettings(settings);
    expect(mockChmod).toHaveBeenCalledWith(
      expect.stringContaining("settings.toml"),
      0o600,
    );
  });
});

describe("getAgentCommand", () => {
  it("returns the first registered agent command", async () => {
    mockReadFile.mockResolvedValue('[agents.codex]\ncommand = "codex"');
    const cmd = await getAgentCommand();
    expect(cmd).toBe("codex");
  });

  it("returns 'claude' when no agents registered", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const cmd = await getAgentCommand();
    expect(cmd).toBe("claude");
  });
});

describe("updateSettings", () => {
  it("merges partial updates", async () => {
    mockReadFile.mockResolvedValue('[actions]\ntake = "old"');
    const updated = await updateSettings({ actions: { take: "new" } });
    expect(updated.actions.take).toBe("new");
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it("merges agents map without clobbering existing entries", async () => {
    const toml = [
      '[agents.claude]',
      'command = "claude"',
      'label = "Claude Code"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const updated = await updateSettings({
      agents: { codex: { command: "codex", label: "OpenAI Codex" } },
    });
    expect(updated.agents.claude).toBeDefined();
    expect(updated.agents.codex.command).toBe("codex");
  });

  it("merges action mappings partially", async () => {
    mockReadFile.mockResolvedValue("");
    const updated = await updateSettings({
      actions: { take: "codex" },
    });
    expect(updated.actions.take).toBe("codex");
    expect(updated.actions.scene).toBe("");
  });

  it("empty partial object leaves all settings unchanged", async () => {
    const toml = [
      '[agents.codex]',
      'command = "codex"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const updated = await updateSettings({});

    expect(updated.agents.codex.command).toBe("codex");
  });
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
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);
    const agents = await getRegisteredAgents();
    expect(agents.claude.command).toBe("claude");
    expect(agents.claude.label).toBe("Claude Code");
  });
});

describe("getActionAgent", () => {
  it("falls back to first registered agent when mapping is empty string", async () => {
    mockReadFile.mockResolvedValue('[agents.claude]\ncommand = "claude"');
    const agent = await getActionAgent("take");
    expect(agent.command).toBe("claude");
  });

  it("falls back to 'claude' when no agents registered and mapping is empty", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const agent = await getActionAgent("take");
    expect(agent.command).toBe("claude");
  });

  it("falls back when mapping is legacy 'default'", async () => {
    const toml = [
      '[actions]',
      'take = "default"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const agent = await getActionAgent("take");
    expect(agent.command).toBe("claude");
  });

  it("returns registered agent when action is mapped", async () => {
    const toml = [
      '[agents.codex]',
      'command = "codex"',
      'model = "o3"',
      'label = "OpenAI Codex"',
      '[actions]',
      'take = "codex"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const agent = await getActionAgent("take");
    expect(agent.command).toBe("codex");
    expect(agent.model).toBe("o3");
    expect(agent.label).toBe("OpenAI Codex");
  });

  it("falls back when mapped agent id is not registered", async () => {
    const toml = [
      '[actions]',
      'take = "missing"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const agent = await getActionAgent("take");
    expect(agent.command).toBe("claude");
  });
});

describe("addRegisteredAgent", () => {
  it("adds an agent to the agents map", async () => {
    mockReadFile.mockResolvedValue("");
    const result = await addRegisteredAgent("gemini", {
      command: "gemini",
      label: "Google Gemini",
    });
    expect(result.agents.gemini.command).toBe("gemini");
    expect(result.agents.gemini.label).toBe("Google Gemini");
  });
});

describe("removeRegisteredAgent", () => {
  it("removes an agent from the agents map", async () => {
    const toml = [
      '[agents.claude]',
      'command = "claude"',
      '[agents.codex]',
      'command = "codex"',
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

describe("getStepAgent", () => {
  it("uses pool when dispatchMode is advanced and pool is configured", async () => {
    const toml = [
      'dispatchMode = "advanced"',
      '[agents.sonnet]',
      'command = "claude"',
      'model = "sonnet-4"',
      'label = "Claude Sonnet"',
      '[actions]',
      'take = "sonnet"',
      '[[pools.implementation]]',
      'agentId = "sonnet"',
      'weight = 1',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const agent = await getStepAgent(WorkflowStep.Implementation, "take");
    expect(agent.model).toBe("sonnet-4");
    expect(agent.label).toBe("Claude Sonnet");
  });

  it("ignores pool when dispatchMode is basic even if pool is configured", async () => {
    const toml = [
      'dispatchMode = "basic"',
      '[agents.sonnet]',
      'command = "claude"',
      'model = "sonnet-4"',
      'label = "Claude Sonnet"',
      '[agents.opus]',
      'command = "claude"',
      'model = "opus"',
      'label = "Claude Opus"',
      '[actions]',
      'take = "opus"',
      '[[pools.implementation]]',
      'agentId = "sonnet"',
      'weight = 1',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const agent = await getStepAgent(WorkflowStep.Implementation, "take");
    // Should use the action mapping (opus), not the pool (sonnet)
    expect(agent.model).toBe("opus");
    expect(agent.label).toBe("Claude Opus");
  });

  it("falls back to action mapping when pool step is empty in advanced mode", async () => {
    const toml = [
      'dispatchMode = "advanced"',
      '[agents.opus]',
      'command = "claude"',
      'model = "opus"',
      'label = "Claude Opus"',
      '[actions]',
      'take = "opus"',
      '[pools]',
      'planning = []',
      'implementation = []',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const agent = await getStepAgent(WorkflowStep.Implementation, "take");
    // No pool configured for implementation, falls back to action mapping
    expect(agent.model).toBe("opus");
    expect(agent.label).toBe("Claude Opus");
  });

  it("falls back to dispatch default when no pool and no action mapping", async () => {
    const toml = [
      'dispatchMode = "advanced"',
      '[agents.my-default]',
      'command = "my-default"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const agent = await getStepAgent(WorkflowStep.Planning);
    expect(agent.command).toBe("my-default");
  });

  it("defaults dispatchMode to basic when not specified", async () => {
    const toml = [
      '[agents.sonnet]',
      'command = "claude"',
      'model = "sonnet-4"',
      'label = "Claude Sonnet"',
      '[agents.opus]',
      'command = "claude"',
      'model = "opus"',
      'label = "Claude Opus"',
      '[actions]',
      'take = "opus"',
      '[[pools.implementation]]',
      'agentId = "sonnet"',
      'weight = 1',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    // dispatchMode defaults to "basic", so pools should be ignored
    const agent = await getStepAgent(WorkflowStep.Implementation, "take");
    expect(agent.model).toBe("opus");
    expect(agent.label).toBe("Claude Opus");
  });

  describe("cross-agent review", () => {
    beforeEach(() => {
      _resetStepAgentMap();
    });

    it("excludes prior action agent when selecting for a review step", async () => {
      const toml = [
        'dispatchMode = "advanced"',
        '[agents.opus]',
        'command = "claude"',
        'model = "opus"',
        'label = "Claude Opus"',
        '[agents.sonnet]',
        'command = "claude"',
        'model = "sonnet-4"',
        'label = "Claude Sonnet"',
        '[[pools.implementation]]',
        'agentId = "opus"',
        'weight = 3',
        '[[pools.implementation_review]]',
        'agentId = "opus"',
        'weight = 3',
        '[[pools.implementation_review]]',
        'agentId = "sonnet"',
        'weight = 1',
      ].join("\n");
      mockReadFile.mockResolvedValue(toml);

      // Record that opus did the implementation for beat-1
      recordStepAgent("beat-1", WorkflowStep.Implementation, "opus");

      // When selecting for implementation review with beatId, opus should be excluded
      const agent = await getStepAgent(
        WorkflowStep.ImplementationReview,
        "take",
        "beat-1",
      );
      expect(agent.agentId).toBe("sonnet");
      expect(agent.model).toBe("sonnet-4");
    });

    it("does not exclude when no prior agent is recorded", async () => {
      const toml = [
        'dispatchMode = "advanced"',
        '[agents.opus]',
        'command = "claude"',
        'model = "opus"',
        'label = "Claude Opus"',
        '[[pools.implementation_review]]',
        'agentId = "opus"',
        'weight = 1',
      ].join("\n");
      mockReadFile.mockResolvedValue(toml);

      // No prior agent recorded, so opus should be selected normally
      const agent = await getStepAgent(
        WorkflowStep.ImplementationReview,
        "take",
        "beat-1",
      );
      expect(agent.agentId).toBe("opus");
    });

    it("does not exclude for non-review steps", async () => {
      const toml = [
        'dispatchMode = "advanced"',
        '[agents.opus]',
        'command = "claude"',
        'model = "opus"',
        'label = "Claude Opus"',
        '[[pools.implementation]]',
        'agentId = "opus"',
        'weight = 1',
      ].join("\n");
      mockReadFile.mockResolvedValue(toml);

      // Even with beatId, non-review steps should not exclude
      const agent = await getStepAgent(
        WorkflowStep.Implementation,
        "take",
        "beat-1",
      );
      expect(agent.agentId).toBe("opus");
    });
  });
});
