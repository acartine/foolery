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
  updateSettings,
  inspectSettingsDefaults,
  inspectStaleSettingsKeys,
  backfillMissingSettingsDefaults,
  cleanStaleSettingsKeys,
  _resetCache,
} from "@/lib/settings";
import {
  DEFAULT_INTERACTIVE_SESSION_TIMEOUT_MINUTES,
} from "@/lib/interactive-session-timeout";
import { DEFAULT_SCOPE_REFINEMENT_PROMPT } from "@/lib/scope-refinement-defaults";

const DEFAULT_ACTIONS = {
  take: "", scene: "", scopeRefinement: "",
};

const DEFAULT_POOLS = {
  orchestration: [],
  planning: [], plan_review: [],
  implementation: [], implementation_review: [],
  shipment: [], shipment_review: [],
  scope_refinement: [],
};

const DEFAULT_SETTINGS = {
  agents: {},
  actions: DEFAULT_ACTIONS,
  backend: { type: "auto" },
  defaults: {
    profileId: "",
    interactiveSessionTimeoutMinutes:
      DEFAULT_INTERACTIVE_SESSION_TIMEOUT_MINUTES,
  },
  scopeRefinement: { prompt: DEFAULT_SCOPE_REFINEMENT_PROMPT },
  pools: DEFAULT_POOLS,
  dispatchMode: "basic",
  maxConcurrentSessions: 5,
  maxClaimsPerQueueType: 10,
  terminalLightTheme: false,
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

  it("prunes orphan action agent ids not present in the agents registry", async () => {
    mockReadFile.mockResolvedValue(
      [
        '[agents.claude-opus]',
        'command = "claude"',
        'model = "claude-opus-4.6"',
        '[actions]',
        'take = "claude"',
        'scene = "claude-opus"',
        'scopeRefinement = "codex"',
      ].join("\n"),
    );
    const settings = await loadSettings();
    expect(settings.actions.take).toBe("");
    expect(settings.actions.scene).toBe("claude-opus");
    expect(settings.actions.scopeRefinement).toBe("");
  });

  it("prunes orphan pool entries whose agent ids aren't registered", async () => {
    mockReadFile.mockResolvedValue(
      [
        '[agents.claude-opus]',
        'command = "claude"',
        'model = "claude-opus-4.6"',
        '[[pools.planning]]',
        'agentId = "claude-opus"',
        'weight = 1',
        '[[pools.planning]]',
        'agentId = "codex"',
        'weight = 2',
      ].join("\n"),
    );
    const settings = await loadSettings();
    expect(settings.pools.planning).toEqual([
      { agentId: "claude-opus", weight: 1 },
    ]);
  });

  it("leaves unknown agent ids alone when no agents are registered", async () => {
    mockReadFile.mockResolvedValue(
      '[actions]\ntake = "claude"',
    );
    const settings = await loadSettings();
    expect(settings.actions.take).toBe("claude");
  });
});

// Auto-migration tests live in `settings-load-migration.test.ts`.

describe("inspectSettingsDefaults", () => {
  it("reports missing default keys for partial files", async () => {
    mockReadFile.mockResolvedValue('[actions]\ntake = ""');
    const result = await inspectSettingsDefaults();
    expect(result.fileMissing).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.missingPaths).toContain("defaults.profileId");
    expect(result.missingPaths).toContain(
      "defaults.interactiveSessionTimeoutMinutes",
    );
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
    expect(written).toContain(
      `interactiveSessionTimeoutMinutes = ${DEFAULT_INTERACTIVE_SESSION_TIMEOUT_MINUTES}`,
    );
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
      ].join("\n"),
    );
    const result = await backfillMissingSettingsDefaults();
    expect(result.changed).toBe(true);
    expect(result.normalizationPaths).toContain(
      "agents.claude-opus.model",
    );
    // Label is computed at canonical write time (added when missing).
    expect(result.normalizationPaths).toContain(
      "agents.claude-opus.label",
    );
    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain('agent_type = "cli"');
    expect(written).toContain('vendor = "claude"');
    expect(written).toContain('model = "claude-opus-4-6"');
    expect(written).toContain('provider = "Claude"');
    expect(written).toContain('agent_name = "Claude"');
    expect(written).toContain('lease_model = "opus/claude"');
    expect(written).toContain('version = "4.6"');
    expect(written).toContain('label = "Claude Opus 4.6"');
  });

  it("does not write when defaults are already present", async () => {
    mockReadFile.mockResolvedValue(
      [
        'dispatchMode = "basic"',
        'maxConcurrentSessions = 5',
        'maxClaimsPerQueueType = 10',
        'terminalLightTheme = false',
        '[actions]', 'take = ""', 'scene = ""',
        'scopeRefinement = ""',
        '[backend]', 'type = "cli"',
        '[defaults]',
        'profileId = ""',
        `interactiveSessionTimeoutMinutes = ${DEFAULT_INTERACTIVE_SESSION_TIMEOUT_MINUTES}`,
        '[scopeRefinement]',
        `prompt = """${DEFAULT_SCOPE_REFINEMENT_PROMPT}"""`,
        '[pools]', 'planning = []', 'plan_review = []',
        'orchestration = []',
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
      defaults: {
        profileId: "",
        interactiveSessionTimeoutMinutes:
          DEFAULT_INTERACTIVE_SESSION_TIMEOUT_MINUTES,
      },
      scopeRefinement: { prompt: DEFAULT_SCOPE_REFINEMENT_PROMPT },
      pools: DEFAULT_POOLS,
      dispatchMode: "basic" as const,
      maxConcurrentSessions: 5,
      maxClaimsPerQueueType: 10,
      terminalLightTheme: false,
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
      defaults: {
        profileId: "",
        interactiveSessionTimeoutMinutes:
          DEFAULT_INTERACTIVE_SESSION_TIMEOUT_MINUTES,
      },
      scopeRefinement: { prompt: DEFAULT_SCOPE_REFINEMENT_PROMPT },
      pools: DEFAULT_POOLS,
      dispatchMode: "basic" as const,
      maxConcurrentSessions: 5,
      maxClaimsPerQueueType: 10,
      terminalLightTheme: false,
    };
    await saveSettings(settings);
    expect(mockChmod).toHaveBeenCalledWith(
      expect.stringContaining("settings.toml"), 0o600,
    );
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

  it("merges terminal light theme updates without clobbering other settings", async () => {
    mockReadFile.mockResolvedValue(
      [
        'maxConcurrentSessions = 7',
        'terminalLightTheme = false',
        '[actions]',
        'take = "claude"',
      ].join("\n"),
    );

    const updated = await updateSettings({
      terminalLightTheme: true,
    });

    expect(updated.terminalLightTheme).toBe(true);
    expect(updated.maxConcurrentSessions).toBe(7);
    expect(updated.actions.take).toBe("claude");
  });

  it("merges interactive timeout defaults without clobbering other settings", async () => {
    mockReadFile.mockResolvedValue(
      [
        '[defaults]',
        'profileId = "autopilot"',
        `interactiveSessionTimeoutMinutes = ${DEFAULT_INTERACTIVE_SESSION_TIMEOUT_MINUTES}`,
        '[actions]',
        'take = "claude"',
      ].join("\n"),
    );

    const updated = await updateSettings({
      defaults: {
        interactiveSessionTimeoutMinutes: 25,
      },
    });

    expect(
      updated.defaults.interactiveSessionTimeoutMinutes,
    ).toBe(25);
    expect(updated.defaults.profileId).toBe(
      "autopilot",
    );
    expect(updated.actions.take).toBe("claude");
  });
});
