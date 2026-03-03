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

// Mock keychain — default: keychain unavailable so existing tests pass unchanged
const mockKeychainSet = vi.fn().mockResolvedValue(false);
const mockKeychainGet = vi.fn().mockResolvedValue(null);
const mockKeychainDelete = vi.fn().mockResolvedValue(true);

vi.mock("@/lib/keychain", () => ({
  keychainSet: (...args: unknown[]) => mockKeychainSet(...args),
  keychainGet: (...args: unknown[]) => mockKeychainGet(...args),
  keychainDelete: (...args: unknown[]) => mockKeychainDelete(...args),
}));

import {
  loadSettings,
  saveSettings,
  getAgentCommand,
  updateSettings,
  inspectSettingsDefaults,
  backfillMissingSettingsDefaults,
  getRegisteredAgents,
  getActionAgent,
  addRegisteredAgent,
  removeRegisteredAgent,
  getStepAgent,
  _resetCache,
} from "@/lib/settings";
import { WorkflowStep } from "@/lib/workflows";
import { recordStepAgent, _resetStepAgentMap } from "@/lib/agent-pool";
import { OPENROUTER_SELECTED_AGENT_ID } from "@/lib/openrouter";

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
  verification: { enabled: false, agent: "", maxRetries: 3 },
  backend: { type: "auto" },
  defaults: { profileId: "" },
  openrouter: { apiKey: "", enabled: false, model: "" },
  pools: DEFAULT_POOLS,
  dispatchMode: "actions",
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetCache();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockChmod.mockResolvedValue(undefined);
  mockKeychainDelete.mockResolvedValue(true);
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
    expect(result.missingPaths).toContain("verification.enabled");
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
    expect(written).toContain("[verification]");
    expect(written).toContain('enabled = false');
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
    expect(written).toContain("[verification]");
  });

  it("does not write when defaults are already present", async () => {
    mockReadFile.mockResolvedValue(
      [
        'dispatchMode = "actions"',
        '[actions]',
        'take = ""',
        'scene = ""',
        'breakdown = ""',
        '[verification]',
        'enabled = false',
        'agent = ""',
        'maxRetries = 3',
        '[backend]',
        'type = "cli"',
        '[defaults]',
        'profileId = ""',
        '[openrouter]',
        'apiKey = ""',
        'enabled = false',
        'model = ""',
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

describe("saveSettings", () => {
  it("writes valid TOML that round-trips", async () => {
    const settings = {
      agents: { "my-agent": { command: "my-agent" } },
      actions: DEFAULT_ACTIONS,
      verification: { enabled: false, agent: "", maxRetries: 3 },
      backend: { type: "auto" as const },
      defaults: { profileId: "" },
      openrouter: { apiKey: "", enabled: false, model: "" },
      pools: { planning: [], plan_review: [], implementation: [], implementation_review: [], shipment: [], shipment_review: [] },
      dispatchMode: "actions" as const,
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
      verification: { enabled: false, agent: "", maxRetries: 3 },
      backend: { type: "auto" as const },
      defaults: { profileId: "" },
      openrouter: { apiKey: "", enabled: false, model: "" },
      pools: DEFAULT_POOLS,
      dispatchMode: "actions" as const,
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

  it("merges openrouter.enabled without clobbering apiKey or model", async () => {
    const toml = [
      '[openrouter]',
      'apiKey = "sk-or-v1-secret"',
      'enabled = false',
      'model = "anthropic/claude-sonnet-4"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const updated = await updateSettings({
      openrouter: { enabled: true },
    });
    expect(updated.openrouter.enabled).toBe(true);
    expect(updated.openrouter.apiKey).toBe("sk-or-v1-secret");
    expect(updated.openrouter.model).toBe("anthropic/claude-sonnet-4");
  });

  it("merges openrouter.apiKey without clobbering enabled or model", async () => {
    const toml = [
      '[openrouter]',
      'apiKey = "old-key"',
      'enabled = true',
      'model = "meta/llama-3"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const updated = await updateSettings({
      openrouter: { apiKey: "new-key" },
    });
    expect(updated.openrouter.apiKey).toBe("new-key");
    expect(updated.openrouter.enabled).toBe(true);
    expect(updated.openrouter.model).toBe("meta/llama-3");
  });

  it("openrouter-only update does not clobber agent config", async () => {
    const toml = [
      '[agents.claude]',
      'command = "claude"',
      'label = "Claude Code"',
      '[actions]',
      'take = "claude"',
      'scene = "claude"',
      'breakdown = ""',
      '[openrouter]',
      'apiKey = ""',
      'enabled = false',
      'model = ""',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const updated = await updateSettings({
      openrouter: { enabled: true, apiKey: "sk-or-v1-new" },
    });

    // OpenRouter fields updated
    expect(updated.openrouter.enabled).toBe(true);
    expect(updated.openrouter.apiKey).toBe("sk-or-v1-new");

    // Agents/actions untouched
    expect(updated.agents.claude).toBeDefined();
    expect(updated.agents.claude.command).toBe("claude");
    expect(updated.actions.take).toBe("claude");
    expect(updated.actions.scene).toBe("claude");
  });

  it("openrouter-only update does not clobber verification or defaults", async () => {
    const toml = [
      '[verification]',
      'enabled = true',
      'agent = "codex"',
      'maxRetries = 5',
      '[defaults]',
      'profileId = "custom"',
      '[openrouter]',
      'apiKey = ""',
      'enabled = false',
      'model = ""',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const updated = await updateSettings({
      openrouter: { model: "openai/gpt-4o" },
    });

    expect(updated.openrouter.model).toBe("openai/gpt-4o");
    expect(updated.verification.enabled).toBe(true);
    expect(updated.verification.agent).toBe("codex");
    expect(updated.verification.maxRetries).toBe(5);
    expect(updated.defaults.profileId).toBe("custom");
  });

  it("empty partial object leaves all settings unchanged", async () => {
    const toml = [
      '[agents.codex]',
      'command = "codex"',
      '[openrouter]',
      'apiKey = "keep"',
      'enabled = true',
      'model = "keep-model"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const updated = await updateSettings({});

    expect(updated.agents.codex.command).toBe("codex");
    expect(updated.openrouter.apiKey).toBe("keep");
    expect(updated.openrouter.enabled).toBe(true);
    expect(updated.openrouter.model).toBe("keep-model");
  });

  it("merges openrouter.model selection without clobbering enabled or apiKey", async () => {
    const toml = [
      '[openrouter]',
      'apiKey = "sk-or-v1-mykey"',
      'enabled = true',
      'model = ""',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const updated = await updateSettings({
      openrouter: { model: "anthropic/claude-sonnet-4" },
    });

    expect(updated.openrouter.model).toBe("anthropic/claude-sonnet-4");
    expect(updated.openrouter.apiKey).toBe("sk-or-v1-mykey");
    expect(updated.openrouter.enabled).toBe(true);
  });

  it("clears openrouter.model by setting empty string", async () => {
    const toml = [
      '[openrouter]',
      'apiKey = "sk-or-v1-mykey"',
      'enabled = true',
      'model = "openai/gpt-4o"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const updated = await updateSettings({
      openrouter: { model: "" },
    });

    expect(updated.openrouter.model).toBe("");
    expect(updated.openrouter.apiKey).toBe("sk-or-v1-mykey");
    expect(updated.openrouter.enabled).toBe(true);
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

  it("resolves the selected OpenRouter model when mapped as an action agent", async () => {
    const toml = [
      "[agents.codex]",
      'command = "codex"',
      "[actions]",
      `take = "${OPENROUTER_SELECTED_AGENT_ID}"`,
      "[openrouter]",
      "enabled = true",
      'model = "mistralai/devstral-small:free"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const agent = await getActionAgent("take");
    expect(agent.command).toBe("codex");
    expect(agent.model).toBe("mistralai/devstral-small:free");
    expect(agent.label).toBe(
      "OpenRouter (mistralai/devstral-small:free)",
    );
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
  it("uses pool when dispatchMode is pools and pool is configured", async () => {
    const toml = [
      'dispatchMode = "pools"',
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

  it("ignores pool when dispatchMode is actions even if pool is configured", async () => {
    const toml = [
      'dispatchMode = "actions"',
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

  it("falls back to action mapping when pool step is empty in pools mode", async () => {
    const toml = [
      'dispatchMode = "pools"',
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

  it("supports selected OpenRouter model as a pool entry", async () => {
    const toml = [
      'dispatchMode = "pools"',
      "[agents.codex]",
      'command = "codex"',
      "[openrouter]",
      "enabled = true",
      'model = "mistralai/devstral-small:free"',
      "[[pools.implementation]]",
      `agentId = "${OPENROUTER_SELECTED_AGENT_ID}"`,
      "weight = 1",
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const agent = await getStepAgent(WorkflowStep.Implementation, "take");
    expect(agent.agentId).toBe(OPENROUTER_SELECTED_AGENT_ID);
    expect(agent.command).toBe("codex");
    expect(agent.model).toBe("mistralai/devstral-small:free");
  });

  it("falls back to dispatch default when no pool and no action mapping", async () => {
    const toml = [
      'dispatchMode = "pools"',
      '[agents.my-default]',
      'command = "my-default"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const agent = await getStepAgent(WorkflowStep.Planning);
    expect(agent.command).toBe("my-default");
  });

  it("defaults dispatchMode to actions when not specified", async () => {
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

    // dispatchMode defaults to "actions", so pools should be ignored
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
        'dispatchMode = "pools"',
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
        'dispatchMode = "pools"',
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
        'dispatchMode = "pools"',
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

describe("keychain integration", () => {
  it("stores API key in keychain when available", async () => {
    mockKeychainSet.mockResolvedValueOnce(true);

    const settings = {
      ...DEFAULT_SETTINGS,
      backend: { type: "auto" as const },
      dispatchMode: "actions" as const,
      openrouter: { apiKey: "sk-or-v1-secret", enabled: true, model: "" },
    };
    await saveSettings(settings);

    expect(mockKeychainSet).toHaveBeenCalledWith("sk-or-v1-secret");
    // TOML should contain sentinel, not the real key
    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("**keychain**");
    expect(written).not.toContain("sk-or-v1-secret");
  });

  it("falls back to plaintext when keychain unavailable", async () => {
    mockKeychainSet.mockResolvedValueOnce(false);

    const settings = {
      ...DEFAULT_SETTINGS,
      backend: { type: "auto" as const },
      dispatchMode: "actions" as const,
      openrouter: { apiKey: "sk-or-v1-secret", enabled: true, model: "" },
    };
    await saveSettings(settings);

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("sk-or-v1-secret");
    expect(written).not.toContain("**keychain**");
  });

  it("deletes keychain entry when key is empty", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      backend: { type: "auto" as const },
      dispatchMode: "actions" as const,
      openrouter: { apiKey: "", enabled: false, model: "" },
    };
    await saveSettings(settings);

    expect(mockKeychainSet).not.toHaveBeenCalled();
    expect(mockKeychainDelete).toHaveBeenCalledTimes(1);
  });

  it("does not call keychainSet when key is already the sentinel", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      backend: { type: "auto" as const },
      dispatchMode: "actions" as const,
      openrouter: { apiKey: "**keychain**", enabled: true, model: "" },
    };
    await saveSettings(settings);

    expect(mockKeychainSet).not.toHaveBeenCalled();
    expect(mockKeychainDelete).not.toHaveBeenCalled();
  });

  it("resolves keychain sentinel when loading", async () => {
    mockKeychainGet.mockResolvedValueOnce("sk-or-v1-from-keychain");

    mockReadFile.mockResolvedValue(
      '[openrouter]\napiKey = "**keychain**"\nenabled = true\nmodel = ""',
    );

    const settings = await loadSettings();
    expect(settings.openrouter.apiKey).toBe("sk-or-v1-from-keychain");
    expect(mockKeychainGet).toHaveBeenCalled();
  });

  it("resolves to empty string when keychain read fails", async () => {
    mockKeychainGet.mockResolvedValueOnce(null);

    mockReadFile.mockResolvedValue(
      '[openrouter]\napiKey = "**keychain**"\nenabled = true\nmodel = ""',
    );

    const settings = await loadSettings();
    expect(settings.openrouter.apiKey).toBe("");
  });

  it("does not call keychainGet when key is not the sentinel", async () => {
    mockReadFile.mockResolvedValue(
      '[openrouter]\napiKey = "sk-plaintext"\nenabled = true\nmodel = ""',
    );

    const settings = await loadSettings();
    expect(settings.openrouter.apiKey).toBe("sk-plaintext");
    expect(mockKeychainGet).not.toHaveBeenCalled();
  });

  it("caches resolved key so keychainGet is not called again", async () => {
    mockKeychainGet.mockResolvedValueOnce("sk-or-v1-cached");

    mockReadFile.mockResolvedValue(
      '[openrouter]\napiKey = "**keychain**"\nenabled = true\nmodel = ""',
    );

    const first = await loadSettings();
    expect(first.openrouter.apiKey).toBe("sk-or-v1-cached");

    // Second call should use cache
    const second = await loadSettings();
    expect(second.openrouter.apiKey).toBe("sk-or-v1-cached");
    expect(mockKeychainGet).toHaveBeenCalledTimes(1);
  });
});
