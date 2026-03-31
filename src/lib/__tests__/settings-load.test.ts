/**
 * Settings tests: loading, saving, inspection, backfill, and update.
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
  loadSettings,
  saveSettings,
  getAgentCommand,
  updateSettings,
  inspectSettingsDefaults,
  inspectStaleSettingsKeys,
  backfillMissingSettingsDefaults,
  cleanStaleSettingsKeys,
  _resetCache,
} from "@/lib/settings";
import { DEFAULT_SCOPE_REFINEMENT_PROMPT } from "@/lib/scope-refinement-defaults";

const DEFAULT_ACTIONS = {
  take: "", scene: "", breakdown: "", scopeRefinement: "",
};

const DEFAULT_POOLS = {
  planning: [], plan_review: [],
  implementation: [], implementation_review: [],
  shipment: [], shipment_review: [],
  scope_refinement: [],
};

const DEFAULT_SETTINGS = {
  agents: {},
  actions: DEFAULT_ACTIONS,
  backend: { type: "auto" },
  defaults: { profileId: "" },
  scopeRefinement: { prompt: DEFAULT_SCOPE_REFINEMENT_PROMPT },
  pools: DEFAULT_POOLS,
  dispatchMode: "basic",
  maxConcurrentSessions: 5,
  maxClaimsPerQueueType: 10,
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
    mockReadFile.mockResolvedValue(
      '[agents.claude]\ncommand = "claude"\nlabel = "Claude"',
    );
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
        '[agent]', 'command = "claude"',
        '[verification]', 'enabled = true',
        '[actions]', 'direct = "codex"',
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
      expect.stringContaining("settings.toml"), 0o600,
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

  it("rewrites legacy dispatch mode values when backfilling", async () => {
    mockReadFile.mockResolvedValue('dispatchMode = "pools"');
    const result = await backfillMissingSettingsDefaults();
    expect(result.changed).toBe(true);
    expect(result.settings.dispatchMode).toBe("advanced");
    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain('dispatchMode = "advanced"');
    expect(written).not.toContain('dispatchMode = "pools"');
  });

  it("normalizes persisted Claude model identifiers when backfilling", async () => {
    mockReadFile.mockResolvedValue(
      [
        '[agents.claude-opus]',
        'command = "claude"',
        'model = "claude-opus-4.6"',
        'label = "Claude Opus 4.6"',
      ].join("\n"),
    );
    const result = await backfillMissingSettingsDefaults();
    expect(result.changed).toBe(true);
    expect(result.normalizationPaths).toContain(
      "agents.claude-opus.model",
    );
    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain('model = "claude-opus-4-6"');
    expect(written).toContain('provider = "Claude"');
    expect(written).toContain('flavor = "opus"');
    expect(written).toContain('version = "4.6"');
  });

  it("does not write when defaults are already present", async () => {
    mockReadFile.mockResolvedValue(
      [
        'dispatchMode = "basic"',
        'maxConcurrentSessions = 5',
        'maxClaimsPerQueueType = 10',
        '[actions]', 'take = ""', 'scene = ""',
        'breakdown = ""', 'scopeRefinement = ""',
        '[backend]', 'type = "cli"',
        '[defaults]', 'profileId = ""',
        '[scopeRefinement]',
        `prompt = """${DEFAULT_SCOPE_REFINEMENT_PROMPT}"""`,
        '[pools]', 'planning = []', 'plan_review = []',
        'implementation = []', 'implementation_review = []',
        'shipment = []', 'shipment_review = []',
        'scope_refinement = []',
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
        '[agent]', 'command = "claude"',
        '[verification]', 'enabled = true',
        '[actions]', 'take = "claude"', 'direct = "codex"',
      ].join("\n"),
    );
    const result = await cleanStaleSettingsKeys();
    expect(result.changed).toBe(true);
    expect(result.stalePaths).toEqual(
      ["agent", "verification", "actions.direct"],
    );
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
      scopeRefinement: { prompt: DEFAULT_SCOPE_REFINEMENT_PROMPT },
      pools: DEFAULT_POOLS,
      dispatchMode: "basic" as const,
      maxConcurrentSessions: 5,
      maxClaimsPerQueueType: 10,
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
      scopeRefinement: { prompt: DEFAULT_SCOPE_REFINEMENT_PROMPT },
      pools: DEFAULT_POOLS,
      dispatchMode: "basic" as const,
      maxConcurrentSessions: 5,
      maxClaimsPerQueueType: 10,
    };
    await saveSettings(settings);
    expect(mockChmod).toHaveBeenCalledWith(
      expect.stringContaining("settings.toml"), 0o600,
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
      '[agents.claude]', 'command = "claude"', 'label = "Claude Code"',
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
    const updated = await updateSettings({ actions: { take: "codex" } });
    expect(updated.actions.take).toBe("codex");
    expect(updated.actions.scene).toBe("");
  });

  it("empty partial object leaves all settings unchanged", async () => {
    const toml = ['[agents.codex]', 'command = "codex"'].join("\n");
    mockReadFile.mockResolvedValue(toml);
    const updated = await updateSettings({});
    expect(updated.agents.codex.command).toBe("codex");
  });

  it("normalizes corrupted Claude model identifiers during load", async () => {
    const toml = [
      '[agents.claude-opus]',
      'command = "claude"',
      'model = "claude-opus-4.6"',
      '[actions]',
      'take = "claude-opus"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);
    const updated = await updateSettings({});
    expect(updated.agents["claude-opus"]).toMatchObject({
      command: "claude",
      model: "claude-opus-4-6",
      provider: "Claude",
      flavor: "opus",
      version: "4.6",
    });
  });
});
