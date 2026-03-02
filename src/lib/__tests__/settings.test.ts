import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:fs/promises before importing the module under test
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
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

const DEFAULT_ACTIONS = {
  take: "",
  scene: "",
  direct: "",
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
  agent: { command: "claude" },
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
});

describe("loadSettings", () => {
  it("returns defaults when no file exists", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const settings = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it("parses valid TOML", async () => {
    mockReadFile.mockResolvedValue('[agent]\ncommand = "my-agent"');
    const settings = await loadSettings();
    expect(settings.agent.command).toBe("my-agent");
  });

  it("falls back to defaults on invalid TOML", async () => {
    mockReadFile.mockResolvedValue("{{{{not valid toml");
    const settings = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it("fills in defaults for missing keys", async () => {
    mockReadFile.mockResolvedValue("[agent]");
    const settings = await loadSettings();
    expect(settings.agent.command).toBe("claude");
  });

  it("uses cache within TTL", async () => {
    mockReadFile.mockResolvedValue('[agent]\ncommand = "cached"');
    await loadSettings();
    await loadSettings();
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });
});

describe("inspectSettingsDefaults", () => {
  it("reports missing default keys for partial files", async () => {
    mockReadFile.mockResolvedValue('[agent]\ncommand = "claude"');
    const result = await inspectSettingsDefaults();
    expect(result.fileMissing).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.missingPaths).toContain("verification.enabled");
    expect(result.missingPaths).toContain("actions.take");
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
  });

  it("writes missing defaults without clobbering existing values", async () => {
    mockReadFile.mockResolvedValue('[agent]\ncommand = "codex"');
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
        '[agent]',
        'command = "claude"',
        '[actions]',
        'take = ""',
        'scene = ""',
        'direct = ""',
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
      agent: { command: "my-agent" },
      agents: {},
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
});

describe("getAgentCommand", () => {
  it("returns the configured command", async () => {
    mockReadFile.mockResolvedValue('[agent]\ncommand = "codex"');
    const cmd = await getAgentCommand();
    expect(cmd).toBe("codex");
  });

  it("returns default when file is missing", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const cmd = await getAgentCommand();
    expect(cmd).toBe("claude");
  });
});

describe("updateSettings", () => {
  it("merges partial updates", async () => {
    mockReadFile.mockResolvedValue('[agent]\ncommand = "old"');
    const updated = await updateSettings({ agent: { command: "new" } });
    expect(updated.agent.command).toBe("new");
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it("merges agents map without clobbering existing entries", async () => {
    const toml = [
      '[agent]',
      'command = "claude"',
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
    mockReadFile.mockResolvedValue('[agent]\ncommand = "claude"');
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
      '[agent]',
      'command = "codex"',
      '[agents.claude]',
      'command = "claude"',
      'label = "Claude Code"',
      '[actions]',
      'take = "claude"',
      'scene = "claude"',
      'direct = ""',
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

    // Agent/agents/actions untouched
    expect(updated.agent.command).toBe("codex");
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
      '[agent]',
      'command = "codex"',
      '[openrouter]',
      'apiKey = "keep"',
      'enabled = true',
      'model = "keep-model"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const updated = await updateSettings({});

    expect(updated.agent.command).toBe("codex");
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
  it("falls back to agent.command when mapping is empty string", async () => {
    mockReadFile.mockResolvedValue('[agent]\ncommand = "claude"');
    const agent = await getActionAgent("take");
    expect(agent.command).toBe("claude");
  });

  it("falls back to agent.command when mapping is legacy 'default'", async () => {
    const toml = [
      '[agent]',
      'command = "claude"',
      '[actions]',
      'take = "default"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const agent = await getActionAgent("take");
    expect(agent.command).toBe("claude");
  });

  it("returns registered agent when action is mapped", async () => {
    const toml = [
      '[agent]',
      'command = "claude"',
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
      '[agent]',
      'command = "claude"',
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
    mockReadFile.mockResolvedValue('[agent]\ncommand = "claude"');
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
    mockReadFile.mockResolvedValue('[agent]\ncommand = "claude"');
    const result = await removeRegisteredAgent("nonexistent");
    expect(result.agents).toEqual({});
  });
});

describe("getStepAgent", () => {
  it("uses pool when dispatchMode is pools and pool is configured", async () => {
    const toml = [
      'dispatchMode = "pools"',
      '[agent]',
      'command = "default-agent"',
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
      '[agent]',
      'command = "default-agent"',
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
      '[agent]',
      'command = "default-agent"',
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

  it("falls back to default agent when no pool and no action mapping", async () => {
    const toml = [
      'dispatchMode = "pools"',
      '[agent]',
      'command = "my-default"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);

    const agent = await getStepAgent(WorkflowStep.Planning);
    expect(agent.command).toBe("my-default");
  });

  it("defaults dispatchMode to actions when not specified", async () => {
    const toml = [
      '[agent]',
      'command = "default-agent"',
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
});
