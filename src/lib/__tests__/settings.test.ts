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
  _resetCache,
} from "@/lib/settings";

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
    expect(settings).toEqual({ agent: { command: "claude" } });
  });

  it("parses valid TOML", async () => {
    mockReadFile.mockResolvedValue('[agent]\ncommand = "my-agent"');
    const settings = await loadSettings();
    expect(settings.agent.command).toBe("my-agent");
  });

  it("falls back to defaults on invalid TOML", async () => {
    mockReadFile.mockResolvedValue("{{{{not valid toml");
    const settings = await loadSettings();
    expect(settings).toEqual({ agent: { command: "claude" } });
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
    const settings = { agent: { command: "my-agent" } };
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
});
