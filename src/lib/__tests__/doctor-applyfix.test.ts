import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Mocks ──────────────────────────────────────────────────

const mockList = vi.fn();
const mockUpdate = vi.fn();
const mockListWorkflows = vi.fn();
vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({
    list: (...args: unknown[]) => mockList(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    listWorkflows: (...args: unknown[]) => mockListWorkflows(...args),
  }),
}));

const mockGetRegisteredAgents = vi.fn();
const mockScanForAgents = vi.fn();
const mockLoadSettings = vi.fn();
const mockInspectSettingsDefaults = vi.fn();
const mockInspectStaleSettingsKeys = vi.fn();
const mockBackfillMissingSettingsDefaults = vi.fn();
const mockInspectSettingsPermissions = vi.fn();
const mockEnsureSettingsPermissions = vi.fn();
const mockCleanStaleSettingsKeys = vi.fn();
vi.mock("@/lib/settings", () => ({
  getRegisteredAgents: () => mockGetRegisteredAgents(),
  scanForAgents: () => mockScanForAgents(),
  loadSettings: () => mockLoadSettings(),
  inspectSettingsDefaults: () => mockInspectSettingsDefaults(),
  inspectStaleSettingsKeys: () => mockInspectStaleSettingsKeys(),
  backfillMissingSettingsDefaults: () => mockBackfillMissingSettingsDefaults(),
  inspectSettingsPermissions: () => mockInspectSettingsPermissions(),
  ensureSettingsPermissions: () => mockEnsureSettingsPermissions(),
  cleanStaleSettingsKeys: () => mockCleanStaleSettingsKeys(),
}));

const mockListRepos = vi.fn();
const mockInspectMissingRepoMemoryManagerTypes = vi.fn();
const mockBackfillMissingRepoMemoryManagerTypes = vi.fn();
const mockInspectRegistryPermissions = vi.fn();
const mockEnsureRegistryPermissions = vi.fn();
const mockUpdateRegisteredRepoMemoryManagerType = vi.fn();
vi.mock("@/lib/registry", () => ({
  listRepos: () => mockListRepos(),
  inspectMissingRepoMemoryManagerTypes: () => mockInspectMissingRepoMemoryManagerTypes(),
  backfillMissingRepoMemoryManagerTypes: () => mockBackfillMissingRepoMemoryManagerTypes(),
  inspectRegistryPermissions: () => mockInspectRegistryPermissions(),
  ensureRegistryPermissions: () => mockEnsureRegistryPermissions(),
  updateRegisteredRepoMemoryManagerType: (...args: unknown[]) =>
    mockUpdateRegisteredRepoMemoryManagerType(...args),
}));

const mockGetReleaseVersionStatus = vi.fn();
vi.mock("@/lib/release-version", () => ({
  getReleaseVersionStatus: () => mockGetReleaseVersionStatus(),
}));

const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === "function") {
      const p = mockExecFile(args[0], args[1]);
      p.then(
        (r: { stdout: string; stderr: string }) => cb(null, r.stdout, r.stderr),
        (e: Error) => cb(e, "", ""),
      );
    }
  },
}));

const mockDetectMemoryManagerType = vi.fn();
vi.mock("@/lib/memory-manager-detection", () => ({
  detectMemoryManagerType: (...args: unknown[]) => mockDetectMemoryManagerType(...args),
}));

import { runDoctorFix } from "@/lib/doctor";

const DEFAULT_SETTINGS = {
  agents: {},
  actions: {
    take: "",
    scene: "",
    breakdown: "",
  },
  backend: { type: "auto" as const },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockListRepos.mockResolvedValue([]);
  mockGetRegisteredAgents.mockResolvedValue({});
  mockLoadSettings.mockResolvedValue(DEFAULT_SETTINGS);
  mockListWorkflows.mockResolvedValue({
    ok: true,
    data: [
      {
        id: "beads-coarse",
        backingWorkflowId: "beads-coarse",
        label: "Beats (Coarse)",
        mode: "coarse_human_gated",
        initialState: "open",
        states: ["open", "in_progress", "retake", "closed"],
        terminalStates: ["closed"],
        finalCutState: null,
        retakeState: "retake",
        promptProfileId: "beads-coarse-human-gated",
      },
    ],
  });
  mockInspectSettingsDefaults.mockResolvedValue({
    settings: DEFAULT_SETTINGS,
    missingPaths: [],
    fileMissing: false,
  });
  mockInspectStaleSettingsKeys.mockResolvedValue({
    stalePaths: [],
    fileMissing: false,
  });
  mockBackfillMissingSettingsDefaults.mockResolvedValue({
    settings: DEFAULT_SETTINGS,
    missingPaths: [],
    fileMissing: false,
    changed: false,
  });
  mockInspectSettingsPermissions.mockResolvedValue({
    fileMissing: false,
    needsFix: false,
    actualMode: 0o600,
  });
  mockEnsureSettingsPermissions.mockResolvedValue({
    fileMissing: false,
    needsFix: false,
    actualMode: 0o600,
    changed: false,
  });
  mockCleanStaleSettingsKeys.mockResolvedValue({
    stalePaths: [],
    fileMissing: false,
    changed: false,
  });
  mockInspectMissingRepoMemoryManagerTypes.mockResolvedValue({
    missingRepoPaths: [],
    fileMissing: false,
  });
  mockBackfillMissingRepoMemoryManagerTypes.mockResolvedValue({
    changed: false,
    migratedRepoPaths: [],
    fileMissing: false,
  });
  mockInspectRegistryPermissions.mockResolvedValue({
    fileMissing: false,
    needsFix: false,
    actualMode: 0o600,
  });
  mockEnsureRegistryPermissions.mockResolvedValue({
    fileMissing: false,
    needsFix: false,
    actualMode: 0o600,
    changed: false,
  });
  mockUpdateRegisteredRepoMemoryManagerType.mockResolvedValue({
    changed: false,
    fileMissing: false,
    repoFound: true,
  });
  mockGetReleaseVersionStatus.mockResolvedValue({
    installedVersion: "1.0.0",
    latestVersion: "1.0.0",
    updateAvailable: false,
  });
  mockDetectMemoryManagerType.mockReturnValue(undefined);
  mockExecFile.mockResolvedValue({ stdout: "1.0.0", stderr: "" });
});

describe("applyFix: config-permissions", () => {
  it("restricts config permissions when strategy is selected", async () => {
    mockInspectRegistryPermissions.mockResolvedValue({
      fileMissing: false,
      needsFix: true,
      actualMode: 0o644,
    });
    mockEnsureRegistryPermissions.mockResolvedValue({
      fileMissing: false,
      needsFix: false,
      actualMode: 0o600,
      changed: true,
    });

    const fixReport = await runDoctorFix({ "config-permissions": "restrict" });
    const fix = fixReport.fixes.find((f) => f.check === "config-permissions");
    expect(fix?.success).toBe(true);
    expect(fix?.message).toContain("Restricted config file permissions");
    expect(mockEnsureRegistryPermissions).toHaveBeenCalledTimes(1);
  });

  it("returns failure when permission fix reports an error", async () => {
    mockInspectSettingsPermissions.mockResolvedValue({
      fileMissing: false,
      needsFix: true,
      actualMode: 0o644,
    });
    mockEnsureSettingsPermissions.mockResolvedValue({
      fileMissing: false,
      needsFix: false,
      changed: false,
      error: "permission denied",
    });

    const fixReport = await runDoctorFix({ "config-permissions": "restrict" });
    const fix = fixReport.fixes.find((f) => f.check === "config-permissions");
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("permission denied");
  });
});

// ── applyFix: settings-defaults ────────────────────────────

describe("applyFix: settings-defaults", () => {
  it("backfills missing settings defaults when strategy is selected", async () => {
    mockInspectSettingsDefaults.mockResolvedValue({
      settings: DEFAULT_SETTINGS,
      missingPaths: ["defaults.profileId"],
      fileMissing: false,
    });
    mockBackfillMissingSettingsDefaults.mockResolvedValue({
      settings: DEFAULT_SETTINGS,
      missingPaths: ["defaults.profileId"],
      fileMissing: false,
      changed: true,
    });

    const fixReport = await runDoctorFix({ "settings-defaults": "backfill" });
    const fix = fixReport.fixes.find((f) => f.check === "settings-defaults");
    expect(fix?.success).toBe(true);
    expect(fix?.message).toContain("Backfilled");
    expect(mockBackfillMissingSettingsDefaults).toHaveBeenCalledTimes(1);
  });

  it("returns failure when backfill reports an error", async () => {
    mockInspectSettingsDefaults.mockResolvedValue({
      settings: DEFAULT_SETTINGS,
      missingPaths: ["defaults.profileId"],
      fileMissing: false,
    });
    mockBackfillMissingSettingsDefaults.mockResolvedValue({
      settings: DEFAULT_SETTINGS,
      missingPaths: [],
      fileMissing: false,
      changed: false,
      error: "permission denied",
    });

    const fixReport = await runDoctorFix({ "settings-defaults": "backfill" });
    const fix = fixReport.fixes.find((f) => f.check === "settings-defaults");
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("permission denied");
  });
});

describe("applyFix: settings-stale-keys", () => {
  it("removes obsolete settings keys when strategy is selected", async () => {
    mockInspectStaleSettingsKeys.mockResolvedValue({
      stalePaths: ["agent", "actions.direct"],
      fileMissing: false,
    });
    mockCleanStaleSettingsKeys.mockResolvedValue({
      stalePaths: ["agent", "actions.direct"],
      fileMissing: false,
      changed: true,
    });

    const fixReport = await runDoctorFix({ "settings-stale-keys": "clean" });
    const fix = fixReport.fixes.find((f) => f.check === "settings-stale-keys");
    expect(fix?.success).toBe(true);
    expect(fix?.message).toContain("Removed 2 stale setting keys");
    expect(mockCleanStaleSettingsKeys).toHaveBeenCalledTimes(1);
  });

  it("returns failure when cleanup reports an error", async () => {
    mockInspectStaleSettingsKeys.mockResolvedValue({
      stalePaths: ["verification"],
      fileMissing: false,
    });
    mockCleanStaleSettingsKeys.mockResolvedValue({
      stalePaths: [],
      fileMissing: false,
      changed: false,
      error: "permission denied",
    });

    const fixReport = await runDoctorFix({ "settings-stale-keys": "clean" });
    const fix = fixReport.fixes.find((f) => f.check === "settings-stale-keys");
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("permission denied");
  });
});

// ── applyFix: repo-memory-managers ────────────────────────────────

describe("applyFix: repo-memory-managers", () => {
  it("backfills missing repo memory manager metadata when strategy is selected", async () => {
    mockInspectMissingRepoMemoryManagerTypes.mockResolvedValue({
      missingRepoPaths: ["/repo-a"],
      fileMissing: false,
    });
    mockBackfillMissingRepoMemoryManagerTypes.mockResolvedValue({
      changed: true,
      migratedRepoPaths: ["/repo-a"],
      fileMissing: false,
    });

    const fixReport = await runDoctorFix({ "repo-memory-managers": "backfill" });
    const fix = fixReport.fixes.find((f) => f.check === "repo-memory-managers");
    expect(fix?.success).toBe(true);
    expect(fix?.message).toContain("Backfilled memory manager metadata");
    expect(mockBackfillMissingRepoMemoryManagerTypes).toHaveBeenCalledTimes(1);
  });

  it("returns failure when repo memory manager backfill reports an error", async () => {
    mockInspectMissingRepoMemoryManagerTypes.mockResolvedValue({
      missingRepoPaths: ["/repo-a"],
      fileMissing: false,
    });
    mockBackfillMissingRepoMemoryManagerTypes.mockResolvedValue({
      changed: false,
      migratedRepoPaths: [],
      fileMissing: false,
      error: "permission denied",
    });

    const fixReport = await runDoctorFix({ "repo-memory-managers": "backfill" });
    const fix = fixReport.fixes.find((f) => f.check === "repo-memory-managers");
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("permission denied");
  });
});

describe("applyFix: registry-consistency", () => {
  it("updates the registered repo memory manager type when strategy is selected", async () => {
    mockListRepos.mockResolvedValue([
      { path: "/repo-a", name: "repo-a", addedAt: "2026-01-01", memoryManagerType: "beads" as const },
    ]);
    mockDetectMemoryManagerType.mockReturnValue("knots");
    mockUpdateRegisteredRepoMemoryManagerType.mockResolvedValue({
      changed: true,
      fileMissing: false,
      repoFound: true,
      previousMemoryManagerType: "beads",
      memoryManagerType: "knots",
    });

    const fixReport = await runDoctorFix({ "registry-consistency": "sync" });
    const fix = fixReport.fixes.find((f) => f.check === "registry-consistency");
    expect(fix?.success).toBe(true);
    expect(fix?.message).toContain("Updated registry memory manager metadata");
    expect(mockUpdateRegisteredRepoMemoryManagerType).toHaveBeenCalledWith("/repo-a", "knots");
  });

  it("returns failure when registry consistency sync reports an error", async () => {
    mockListRepos.mockResolvedValue([
      { path: "/repo-a", name: "repo-a", addedAt: "2026-01-01", memoryManagerType: "beads" as const },
    ]);
    mockDetectMemoryManagerType.mockReturnValue("knots");
    mockUpdateRegisteredRepoMemoryManagerType.mockResolvedValue({
      changed: false,
      fileMissing: false,
      repoFound: true,
      error: "permission denied",
    });

    const fixReport = await runDoctorFix({ "registry-consistency": "sync" });
    const fix = fixReport.fixes.find((f) => f.check === "registry-consistency");
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("permission denied");
  });
});

// ── applyFix: stale-parent ──────────────────────────────────

describe("applyFix: stale-parent", () => {
  const repos = [{ path: "/repo", name: "test-repo", addedAt: "2026-01-01" }];

  function setupStaleParent() {
    mockListRepos.mockResolvedValue(repos);
    mockList.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "parent-1",
          title: "Epic",
          state: "open",
          labels: [],
          type: "epic",
          priority: 2,
          created: "2026-01-01",
          updated: "2026-01-01",
        },
        {
          id: "child-1",
          title: "Task 1",
          state: "closed",
          labels: [],
          type: "task",
          priority: 2,
          parent: "parent-1",
          created: "2026-01-01",
          updated: "2026-01-01",
        },
      ],
    });
    mockUpdate.mockResolvedValue({ ok: true });
  }

  it("fixes stale parent by setting in_progress state", async () => {
    setupStaleParent();

    const fixReport = await runDoctorFix({ "stale-parent": "default" });
    const fix = fixReport.fixes.find((f) => f.check === "stale-parent");
    expect(fix?.success).toBe(true);
    expect(fix?.message).toContain("in_progress");
    expect(fix?.message).toContain("parent-1");
    expect(mockUpdate).toHaveBeenCalledWith(
      "parent-1",
      { state: "in_progress" },
      "/repo",
    );
  });

  it("returns failure when updateBeat fails for stale parent", async () => {
    setupStaleParent();
    mockUpdate.mockResolvedValue({ ok: false, error: { code: "UNKNOWN", message: "bd broke", retryable: false } });

    const fixReport = await runDoctorFix({ "stale-parent": "default" });
    const fix = fixReport.fixes.find((f) => f.check === "stale-parent");
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("bd broke");
  });

  it("returns failure when updateBeat throws for stale parent", async () => {
    setupStaleParent();
    mockUpdate.mockRejectedValue(new Error("network timeout"));

    const fixReport = await runDoctorFix({ "stale-parent": "default" });
    const fix = fixReport.fixes.find((f) => f.check === "stale-parent");
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("network timeout");
  });
});

// ── applyFix: prompt-guidance ────────────────────────────────

describe("applyFix: prompt-guidance", () => {
  it("appends template content when PROMPT.md exists and no managed block present", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "foolery-fix-prompt-"));
    try {
      // Create AGENTS.md without the marker so doctor detects the issue
      await writeFile(join(repoPath, "AGENTS.md"), "# Agents\n");
      // Create PROMPT.md template in cwd for readPromptTemplate to find
      const originalCwd = process.cwd();
      process.chdir(repoPath);
      await writeFile(join(repoPath, "PROMPT.md"), "<!-- FOOLERY_GUIDANCE_PROMPT_START -->\nGuidance content\n<!-- FOOLERY_GUIDANCE_PROMPT_END -->");

      mockListRepos.mockResolvedValue([
        { path: repoPath, name: "test-repo", addedAt: "2026-01-01" },
      ]);
      mockList.mockResolvedValue({ ok: true, data: [] });

      const fixReport = await runDoctorFix({ "prompt-guidance": "append" });
      const fix = fixReport.fixes.find((f) => f.check === "prompt-guidance");
      expect(fix?.success).toBe(true);
      expect(fix?.message).toContain("Appended Foolery guidance");

      // Verify file was actually modified
      const content = await readFile(join(repoPath, "AGENTS.md"), "utf8");
      expect(content).toContain("FOOLERY_GUIDANCE_PROMPT_START");

      process.chdir(originalCwd);
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  it("replaces existing managed block instead of duplicating", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "foolery-fix-upsert-"));
    try {
      const oldBlock =
        "# Agents\n\n<!-- FOOLERY_GUIDANCE_PROMPT_START -->\nFOOLERY_PROMPT_PROFILE: old-profile\nOld guidance\n<!-- FOOLERY_GUIDANCE_PROMPT_END -->\n";
      await writeFile(join(repoPath, "CLAUDE.md"), oldBlock);
      const originalCwd = process.cwd();
      process.chdir(repoPath);
      await writeFile(
        join(repoPath, "PROMPT.md"),
        "<!-- FOOLERY_GUIDANCE_PROMPT_START -->\nFOOLERY_PROMPT_PROFILE: autopilot\nNew guidance\n<!-- FOOLERY_GUIDANCE_PROMPT_END -->",
      );

      mockListWorkflows.mockResolvedValue({
        ok: true,
        data: [{ id: "autopilot", promptProfileId: "autopilot" }],
      });
      mockListRepos.mockResolvedValue([
        { path: repoPath, name: "test-repo", addedAt: "2026-01-01" },
      ]);
      mockList.mockResolvedValue({ ok: true, data: [] });

      const fixReport = await runDoctorFix({ "prompt-guidance": "append" });
      const fix = fixReport.fixes.find((f) => f.check === "prompt-guidance");
      expect(fix?.success).toBe(true);
      expect(fix?.message).toContain("Updated Foolery guidance");

      const content = await readFile(join(repoPath, "CLAUDE.md"), "utf8");
      // Should contain new guidance, not old
      expect(content).toContain("New guidance");
      expect(content).not.toContain("Old guidance");
      expect(content).not.toContain("old-profile");
      // Should not have duplicate start markers
      expect(content.split("FOOLERY_GUIDANCE_PROMPT_START").length).toBe(2); // 1 occurrence = 2 parts

      process.chdir(originalCwd);
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  it("injects profile marker into knots template that lacks one", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "foolery-fix-knots-"));
    try {
      await writeFile(join(repoPath, "AGENTS.md"), "# Agents\n");
      const originalCwd = process.cwd();
      process.chdir(repoPath);
      // Knots template without profile marker
      await writeFile(
        join(repoPath, "PROMPT_KNOTS.md"),
        "<!-- FOOLERY_GUIDANCE_PROMPT_START -->\n## Foolery Agent Handoff Contract\nKnots rules\n<!-- FOOLERY_GUIDANCE_PROMPT_END -->",
      );

      mockDetectMemoryManagerType.mockReturnValue("knots");
      mockListWorkflows.mockResolvedValue({
        ok: true,
        data: [{ id: "autopilot", promptProfileId: "autopilot" }],
      });
      mockListRepos.mockResolvedValue([
        { path: repoPath, name: "knots-repo", addedAt: "2026-01-01" },
      ]);
      mockList.mockResolvedValue({ ok: true, data: [] });

      const fixReport = await runDoctorFix({ "prompt-guidance": "append" });
      const fix = fixReport.fixes.find((f) => f.check === "prompt-guidance");
      expect(fix?.success).toBe(true);

      const content = await readFile(join(repoPath, "AGENTS.md"), "utf8");
      expect(content).toContain("FOOLERY_PROMPT_PROFILE: autopilot");
      expect(content).toContain("Knots rules");

      process.chdir(originalCwd);
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  it("fails when PROMPT.md is not found", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "foolery-fix-no-prompt-"));
    try {
      await writeFile(join(repoPath, "AGENTS.md"), "# Agents\n");
      const originalCwd = process.cwd();
      // chdir to a temp dir that does NOT have PROMPT.md
      const emptyCwd = await mkdtemp(join(tmpdir(), "foolery-empty-cwd-"));
      process.chdir(emptyCwd);

      // Clear environment variable too
      const originalEnv = process.env.FOOLERY_APP_DIR;
      delete process.env.FOOLERY_APP_DIR;

      mockListRepos.mockResolvedValue([
        { path: repoPath, name: "test-repo", addedAt: "2026-01-01" },
      ]);
      mockList.mockResolvedValue({ ok: true, data: [] });

      const fixReport = await runDoctorFix({ "prompt-guidance": "append" });
      const fix = fixReport.fixes.find((f) => f.check === "prompt-guidance");
      expect(fix?.success).toBe(false);
      expect(fix?.message).toContain("Prompt template not found");

      process.chdir(originalCwd);
      if (originalEnv) process.env.FOOLERY_APP_DIR = originalEnv;
      await rm(emptyCwd, { recursive: true, force: true });
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });
});

// ── applyFix: default (unknown check) ───────────────────────

describe("applyFix: context filtering", () => {
  it("filters fixes by context when strategies include contexts", async () => {
    const repos = [{ path: "/repo", name: "test-repo", addedAt: "2026-01-01" }];
    mockListRepos.mockResolvedValue(repos);
    mockList.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "parent-1",
          title: "Parent beat",
          state: "open",
          labels: [],
          type: "epic",
          priority: 2,
          created: "2026-01-01",
          updated: "2026-01-01",
        },
        {
          id: "child-1",
          title: "Child beat",
          state: "closed",
          labels: [],
          type: "task",
          priority: 2,
          parent: "parent-1",
          created: "2026-01-01",
          updated: "2026-01-01",
        },
      ],
    });
    mockUpdate.mockResolvedValue({ ok: true });

    // Use context filter that matches
    const fixReport = await runDoctorFix({
      "stale-parent": {
        strategy: "mark-in-progress",
        contexts: [{ beatId: "parent-1", repoPath: "/repo" }],
      },
    });
    const fix = fixReport.fixes.find((f) => f.check === "stale-parent");
    expect(fix?.success).toBe(true);
  });

  it("skips fix when context does not match", async () => {
    const repos = [{ path: "/repo", name: "test-repo", addedAt: "2026-01-01" }];
    mockListRepos.mockResolvedValue(repos);
    mockList.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "parent-1",
          title: "Parent beat",
          state: "open",
          labels: [],
          type: "epic",
          priority: 2,
          created: "2026-01-01",
          updated: "2026-01-01",
        },
        {
          id: "child-1",
          title: "Child beat",
          state: "closed",
          labels: [],
          type: "task",
          priority: 2,
          parent: "parent-1",
          created: "2026-01-01",
          updated: "2026-01-01",
        },
      ],
    });
    mockUpdate.mockResolvedValue({ ok: true });

    const fixReport = await runDoctorFix({
      "stale-parent": {
        strategy: "mark-in-progress",
        contexts: [{ beatId: "other-beat", repoPath: "/other-repo" }],
      },
    });
    const fix = fixReport.fixes.find((f) => f.check === "stale-parent");
    expect(fix).toBeUndefined();
  });
});
