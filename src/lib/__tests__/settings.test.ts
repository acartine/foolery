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
  getRegisteredAgents,
  getActionAgent,
  addRegisteredAgent,
  removeRegisteredAgent,
  _resetCache,
} from "@/lib/settings";

const DEFAULT_ACTIONS = {
  take: "default",
  scene: "default",
  direct: "default",
  breakdown: "default",
  hydration: "default",
};

const DEFAULT_SETTINGS = {
  agent: { command: "claude" },
  agents: {},
  actions: DEFAULT_ACTIONS,
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

describe("saveSettings", () => {
  it("writes valid TOML that round-trips", async () => {
    const settings = {
      agent: { command: "my-agent" },
      agents: {},
      actions: DEFAULT_ACTIONS,
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
    expect(updated.actions.scene).toBe("default");
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
  it("falls back to agent.command when mapping is default", async () => {
    mockReadFile.mockResolvedValue('[agent]\ncommand = "claude"');
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
