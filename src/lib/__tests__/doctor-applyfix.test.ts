import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Mocks ──────────────────────────────────────────────────

const mockListBeads = vi.fn();
const mockUpdateBead = vi.fn();
vi.mock("@/lib/bd", () => ({
  listBeads: (...args: unknown[]) => mockListBeads(...args),
  updateBead: (...args: unknown[]) => mockUpdateBead(...args),
}));

const mockGetRegisteredAgents = vi.fn();
const mockScanForAgents = vi.fn();
const mockLoadSettings = vi.fn();
const mockInspectSettingsDefaults = vi.fn();
const mockBackfillMissingSettingsDefaults = vi.fn();
vi.mock("@/lib/settings", () => ({
  getRegisteredAgents: () => mockGetRegisteredAgents(),
  scanForAgents: () => mockScanForAgents(),
  loadSettings: () => mockLoadSettings(),
  inspectSettingsDefaults: () => mockInspectSettingsDefaults(),
  backfillMissingSettingsDefaults: () => mockBackfillMissingSettingsDefaults(),
}));

const mockListRepos = vi.fn();
vi.mock("@/lib/registry", () => ({
  listRepos: () => mockListRepos(),
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

import { runDoctorFix } from "@/lib/doctor";

const DEFAULT_SETTINGS = {
  agent: { command: "claude" },
  agents: {},
  actions: {
    take: "",
    scene: "",
    direct: "",
    breakdown: "",
  },
  verification: { enabled: false, agent: "" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockListRepos.mockResolvedValue([]);
  mockGetRegisteredAgents.mockResolvedValue({});
  mockInspectSettingsDefaults.mockResolvedValue({
    settings: DEFAULT_SETTINGS,
    missingPaths: [],
    fileMissing: false,
  });
  mockBackfillMissingSettingsDefaults.mockResolvedValue({
    settings: DEFAULT_SETTINGS,
    missingPaths: [],
    fileMissing: false,
    changed: false,
  });
  mockGetReleaseVersionStatus.mockResolvedValue({
    installedVersion: "1.0.0",
    latestVersion: "1.0.0",
    updateAvailable: false,
  });
});

// ── applyFix: settings-defaults ────────────────────────────

describe("applyFix: settings-defaults", () => {
  it("backfills missing settings defaults when strategy is selected", async () => {
    mockInspectSettingsDefaults.mockResolvedValue({
      settings: DEFAULT_SETTINGS,
      missingPaths: ["verification.enabled"],
      fileMissing: false,
    });
    mockBackfillMissingSettingsDefaults.mockResolvedValue({
      settings: DEFAULT_SETTINGS,
      missingPaths: ["verification.enabled"],
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
      missingPaths: ["verification.enabled"],
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

// ── applyFix: stale-parent ──────────────────────────────────

describe("applyFix: stale-parent", () => {
  const repos = [{ path: "/repo", name: "test-repo", addedAt: "2026-01-01" }];

  function setupStaleParent() {
    mockListRepos.mockResolvedValue(repos);
    mockListBeads.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "parent-1",
          title: "Epic",
          status: "open",
          labels: [],
          type: "epic",
          priority: 2,
          created: "2026-01-01",
          updated: "2026-01-01",
        },
        {
          id: "child-1",
          title: "Task 1",
          status: "closed",
          labels: [],
          type: "task",
          priority: 2,
          parent: "parent-1",
          created: "2026-01-01",
          updated: "2026-01-01",
        },
      ],
    });
    mockUpdateBead.mockResolvedValue({ ok: true });
  }

  it("fixes stale parent by setting in_progress with verification label", async () => {
    setupStaleParent();

    const fixReport = await runDoctorFix({ "stale-parent": "default" });
    const fix = fixReport.fixes.find((f) => f.check === "stale-parent");
    expect(fix?.success).toBe(true);
    expect(fix?.message).toContain("in_progress");
    expect(fix?.message).toContain("parent-1");
    expect(mockUpdateBead).toHaveBeenCalledWith(
      "parent-1",
      { labels: ["stage:verification"], status: "in_progress" },
      "/repo",
    );
  });

  it("returns failure when updateBead fails for stale parent", async () => {
    setupStaleParent();
    mockUpdateBead.mockResolvedValue({ ok: false, error: "bd broke" });

    const fixReport = await runDoctorFix({ "stale-parent": "default" });
    const fix = fixReport.fixes.find((f) => f.check === "stale-parent");
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("bd broke");
  });

  it("returns failure when updateBead throws for stale parent", async () => {
    setupStaleParent();
    mockUpdateBead.mockRejectedValue(new Error("network timeout"));

    const fixReport = await runDoctorFix({ "stale-parent": "default" });
    const fix = fixReport.fixes.find((f) => f.check === "stale-parent");
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("network timeout");
  });
});

// ── applyFix: corrupt-bead-verification error paths ─────────

describe("applyFix: corrupt-bead-verification error paths", () => {
  const repos = [{ path: "/repo", name: "test-repo", addedAt: "2026-01-01" }];

  function setupCorruptBead() {
    mockListRepos.mockResolvedValue(repos);
    mockListBeads.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "b-fix",
          title: "Fixable",
          status: "open",
          labels: ["stage:verification"],
          type: "task",
          priority: 2,
          created: "2026-01-01",
          updated: "2026-01-01",
        },
      ],
    });
  }

  it("returns failure when updateBead fails for set-in-progress", async () => {
    setupCorruptBead();
    mockUpdateBead.mockResolvedValue({ ok: false, error: "bd update failed" });

    const fixReport = await runDoctorFix({ "corrupt-bead-verification": "set-in-progress" });
    const fix = fixReport.fixes.find((f) => f.check === "corrupt-bead-verification");
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("bd update failed");
  });

  it("returns failure when updateBead fails for remove-label", async () => {
    setupCorruptBead();
    mockUpdateBead.mockResolvedValue({ ok: false });

    const fixReport = await runDoctorFix({ "corrupt-bead-verification": "remove-label" });
    const fix = fixReport.fixes.find((f) => f.check === "corrupt-bead-verification");
    expect(fix?.success).toBe(false);
  });

  it("returns failure when updateBead throws", async () => {
    setupCorruptBead();
    mockUpdateBead.mockRejectedValue(new Error("crash"));

    const fixReport = await runDoctorFix({ "corrupt-bead-verification": "set-in-progress" });
    const fix = fixReport.fixes.find((f) => f.check === "corrupt-bead-verification");
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("crash");
  });
});

// ── applyFix: prompt-guidance ────────────────────────────────

describe("applyFix: prompt-guidance", () => {
  it("appends template content when PROMPT.md exists", async () => {
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
      mockListBeads.mockResolvedValue({ ok: true, data: [] });

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
      mockListBeads.mockResolvedValue({ ok: true, data: [] });

      const fixReport = await runDoctorFix({ "prompt-guidance": "append" });
      const fix = fixReport.fixes.find((f) => f.check === "prompt-guidance");
      expect(fix?.success).toBe(false);
      expect(fix?.message).toContain("PROMPT.md template not found");

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
    mockListBeads.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "b-1",
          title: "Bad bead",
          status: "open",
          labels: ["stage:verification"],
          type: "task",
          priority: 2,
          created: "2026-01-01",
          updated: "2026-01-01",
        },
      ],
    });
    mockUpdateBead.mockResolvedValue({ ok: true });

    // Use context filter that matches
    const fixReport = await runDoctorFix({
      "corrupt-bead-verification": {
        strategy: "set-in-progress",
        contexts: [{ beadId: "b-1", repoPath: "/repo" }],
      },
    });
    const fix = fixReport.fixes.find((f) => f.check === "corrupt-bead-verification");
    expect(fix?.success).toBe(true);
  });

  it("skips fix when context does not match", async () => {
    const repos = [{ path: "/repo", name: "test-repo", addedAt: "2026-01-01" }];
    mockListRepos.mockResolvedValue(repos);
    mockListBeads.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "b-1",
          title: "Bad bead",
          status: "open",
          labels: ["stage:verification"],
          type: "task",
          priority: 2,
          created: "2026-01-01",
          updated: "2026-01-01",
        },
      ],
    });
    mockUpdateBead.mockResolvedValue({ ok: true });

    const fixReport = await runDoctorFix({
      "corrupt-bead-verification": {
        strategy: "set-in-progress",
        contexts: [{ beadId: "other-bead", repoPath: "/other-repo" }],
      },
    });
    const fix = fixReport.fixes.find((f) => f.check === "corrupt-bead-verification");
    expect(fix).toBeUndefined();
  });
});
