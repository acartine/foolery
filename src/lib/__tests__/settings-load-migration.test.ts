/**
 * Settings auto-migration: legacy `settings.toml` agent entries are
 * canonicalised on first read and persisted back to disk via the same
 * atomic write path used by `saveSettings`.
 *
 * Acceptance criterion AC-B4 from knot foolery-c4a6 (Path B refactor).
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

import { loadSettings, _resetCache } from "@/lib/settings";

beforeEach(() => {
  vi.clearAllMocks();
  _resetCache();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockChmod.mockResolvedValue(undefined);
});

describe("loadSettings auto-migration to canonical agent shape", () => {
  it("persists canonical fields back to disk on first read of a legacy entry", async () => {
    // Legacy entry: only command + model, missing canonical fields.
    mockReadFile.mockResolvedValue(
      [
        "[agents.claude-opus]",
        'command = "claude"',
        'model = "claude-opus-4.6"',
      ].join("\n"),
    );
    const settings = await loadSettings();
    // In-memory result is canonical.
    expect(settings.agents["claude-opus"]).toMatchObject({
      command: "claude",
      agent_type: "cli",
      vendor: "claude",
      provider: "Claude",
      agent_name: "Claude",
      lease_model: "opus/claude",
      model: "claude-opus-4-6",
      flavor: "opus",
      version: "4.6",
    });
    // The legacy entry was non-canonical, so the migration write fired.
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain('agent_type = "cli"');
    expect(written).toContain('provider = "Claude"');
    expect(written).toContain('lease_model = "opus/claude"');
    expect(written).toContain('flavor = "opus"');
    expect(written).toContain('model = "claude-opus-4-6"');
    expect(written).toContain('version = "4.6"');
    expect(mockChmod).toHaveBeenCalledWith(
      expect.stringContaining("settings.toml"),
      0o600,
    );
  });

  it("is idempotent — a second read of canonical settings does not write", async () => {
    // Already-canonical TOML on disk.
    mockReadFile.mockResolvedValue(
      [
        "[agents.claude-opus]",
        'command = "claude"',
        'agent_type = "cli"',
        'vendor = "claude"',
        'provider = "Claude"',
        'agent_name = "Claude"',
        'lease_model = "opus/claude"',
        'model = "claude-opus-4-6"',
        'flavor = "opus"',
        'version = "4.6"',
        'label = "Claude Opus 4.6"',
      ].join("\n"),
    );
    await loadSettings();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("preserves user-supplied non-canonical fields (approvalMode) during migration", async () => {
    mockReadFile.mockResolvedValue(
      [
        "[agents.claude-opus]",
        'command = "claude"',
        'model = "claude-opus-4.6"',
        'approvalMode = "prompt"',
      ].join("\n"),
    );
    const settings = await loadSettings();
    expect(settings.agents["claude-opus"]).toMatchObject({
      command: "claude",
      model: "claude-opus-4-6",
      approvalMode: "prompt",
    });
    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain('approvalMode = "prompt"');
  });

  it("does not write when the file is missing (defaults-only path)", async () => {
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockReadFile.mockRejectedValue(err);
    await loadSettings();
    // No agents to migrate; auto-migration write must not fire when the
    // file doesn't exist yet.
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("does not write when only non-agent fields would change", async () => {
    // dispatchMode legacy value triggers normalizeLegacySettings but is
    // not an agent-level migration. The auto-migration only fires when an
    // agents.* path changed.
    mockReadFile.mockResolvedValue('dispatchMode = "actions"');
    await loadSettings();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
