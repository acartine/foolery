/**
 * Doctor coverage tests: applyFix / runDoctorFix paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

const mockInspectSettingsDefaults = vi.fn();
const mockInspectStaleSettingsKeys = vi.fn();
const mockBackfillMissingSettingsDefaults = vi.fn();
const mockInspectSettingsPermissions = vi.fn();
const mockEnsureSettingsPermissions = vi.fn();
const mockCleanStaleSettingsKeys = vi.fn();
vi.mock("@/lib/settings", () => ({
  getRegisteredAgents: vi.fn(async () => ({})),
  inspectSettingsDefaults: () => mockInspectSettingsDefaults(),
  inspectStaleSettingsKeys: () => mockInspectStaleSettingsKeys(),
  backfillMissingSettingsDefaults: () =>
    mockBackfillMissingSettingsDefaults(),
  inspectSettingsPermissions: () => mockInspectSettingsPermissions(),
  ensureSettingsPermissions: () => mockEnsureSettingsPermissions(),
  cleanStaleSettingsKeys: () => mockCleanStaleSettingsKeys(),
}));

const mockListRepos = vi.fn();
const mockInspectMissingRepoMemoryManagerTypes = vi.fn();
const mockBackfillMissingRepoMemoryManagerTypes = vi.fn();
const mockInspectRegistryPermissions = vi.fn();
const mockEnsureRegistryPermissions = vi.fn();
vi.mock("@/lib/registry", () => ({
  listRepos: () => mockListRepos(),
  inspectMissingRepoMemoryManagerTypes: () =>
    mockInspectMissingRepoMemoryManagerTypes(),
  backfillMissingRepoMemoryManagerTypes: () =>
    mockBackfillMissingRepoMemoryManagerTypes(),
  inspectRegistryPermissions: () => mockInspectRegistryPermissions(),
  ensureRegistryPermissions: () => mockEnsureRegistryPermissions(),
}));

vi.mock("@/lib/release-version", () => ({
  getReleaseVersionStatus: vi.fn(async () => ({
    installedVersion: "1.0.0", latestVersion: "1.0.0",
    updateAvailable: false,
  })),
}));

vi.mock("@/lib/knots", () => ({
  listLeases: vi.fn(async () => ({ ok: true, data: [] })),
}));

vi.mock("@/lib/lease-audit", () => ({
  logLeaseAudit: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === "function") cb(null, "", "");
  },
}));

vi.mock("@/lib/memory-manager-detection", () => ({
  detectMemoryManagerType: vi.fn(() => undefined),
}));

import { runDoctorFix } from "@/lib/doctor";

beforeEach(() => {
  vi.clearAllMocks();
  mockListRepos.mockResolvedValue([]);
  mockListWorkflows.mockResolvedValue({ ok: true, data: [] });
  mockInspectSettingsDefaults.mockResolvedValue({
    missingPaths: [], fileMissing: false,
  });
  mockInspectStaleSettingsKeys.mockResolvedValue({
    stalePaths: [], fileMissing: false,
  });
  mockBackfillMissingSettingsDefaults.mockResolvedValue({
    missingPaths: [], changed: false,
  });
  mockInspectSettingsPermissions.mockResolvedValue({
    fileMissing: false, needsFix: false, actualMode: 0o600,
  });
  mockEnsureSettingsPermissions.mockResolvedValue({
    fileMissing: false, needsFix: false, changed: false,
  });
  mockCleanStaleSettingsKeys.mockResolvedValue({
    stalePaths: [], changed: false,
  });
  mockInspectMissingRepoMemoryManagerTypes.mockResolvedValue({
    missingRepoPaths: [], fileMissing: false,
  });
  mockBackfillMissingRepoMemoryManagerTypes.mockResolvedValue({
    changed: false, migratedRepoPaths: [],
  });
  mockInspectRegistryPermissions.mockResolvedValue({
    fileMissing: false, needsFix: false, actualMode: 0o600,
  });
  mockEnsureRegistryPermissions.mockResolvedValue({
    fileMissing: false, needsFix: false, actualMode: 0o600, changed: false,
  });
});

describe("applyFix: unknown strategy", () => {
  it("returns failure for unknown settings-defaults strategy", async () => {
    mockInspectSettingsDefaults.mockResolvedValue({
      missingPaths: ["a.b"], fileMissing: false,
    });
    const report = await runDoctorFix({
      "settings-defaults": "unknown-strategy",
    });
    const fix = report.fixes.find((f) => f.check === "settings-defaults");
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("Unknown strategy");
  });

  it("returns failure for unknown repo-memory-managers strategy", async () => {
    mockInspectMissingRepoMemoryManagerTypes.mockResolvedValue({
      missingRepoPaths: ["/a"], fileMissing: false,
    });
    const report = await runDoctorFix({
      "repo-memory-managers": "unknown-strategy",
    });
    const fix = report.fixes.find(
      (f) => f.check === "repo-memory-managers",
    );
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("Unknown strategy");
  });

  it("returns failure for unknown config-permissions strategy", async () => {
    mockInspectRegistryPermissions.mockResolvedValue({
      fileMissing: false, needsFix: true, actualMode: 0o644,
    });
    const report = await runDoctorFix({
      "config-permissions": "unknown-strategy",
    });
    const fix = report.fixes.find(
      (f) => f.check === "config-permissions",
    );
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("Unknown strategy");
  });
});

describe("applyFix: config-permissions no-change", () => {
  it("succeeds with no-change message", async () => {
    mockInspectRegistryPermissions.mockResolvedValue({
      fileMissing: false, needsFix: true, actualMode: 0o644,
    });
    mockEnsureSettingsPermissions.mockResolvedValue({
      fileMissing: false, needsFix: false, changed: false,
    });
    mockEnsureRegistryPermissions.mockResolvedValue({
      fileMissing: false, needsFix: false, changed: false,
    });
    const report = await runDoctorFix({
      "config-permissions": "restrict",
    });
    const fix = report.fixes.find(
      (f) => f.check === "config-permissions",
    );
    expect(fix?.success).toBe(true);
    expect(fix?.message).toContain("already restricted");
  });

  it("fails when permission fix throws", async () => {
    mockInspectSettingsPermissions.mockResolvedValue({
      fileMissing: false, needsFix: true, actualMode: 0o644,
    });
    mockEnsureSettingsPermissions.mockRejectedValue(new Error("io error"));
    const report = await runDoctorFix({
      "config-permissions": "restrict",
    });
    const fix = report.fixes.find(
      (f) => f.check === "config-permissions",
    );
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("io error");
  });

  it("returns failure for unknown settings-stale-keys strategy", async () => {
    mockInspectStaleSettingsKeys.mockResolvedValue({
      stalePaths: ["agent"], fileMissing: false,
    });
    const report = await runDoctorFix({
      "settings-stale-keys": "unknown-strategy",
    });
    const fix = report.fixes.find(
      (f) => f.check === "settings-stale-keys",
    );
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("Unknown strategy");
  });
});

describe("applyFix: settings-defaults no-change", () => {
  it("succeeds with no-change message when already present", async () => {
    mockInspectSettingsDefaults.mockResolvedValue({
      missingPaths: ["a.b"], fileMissing: false,
    });
    mockBackfillMissingSettingsDefaults.mockResolvedValue({
      missingPaths: [], changed: false,
    });
    const report = await runDoctorFix({
      "settings-defaults": "backfill",
    });
    const fix = report.fixes.find(
      (f) => f.check === "settings-defaults",
    );
    expect(fix?.success).toBe(true);
    expect(fix?.message).toContain("already present");
  });

  it("fails when backfill throws", async () => {
    mockInspectSettingsDefaults.mockResolvedValue({
      missingPaths: ["a.b"], fileMissing: false,
    });
    mockBackfillMissingSettingsDefaults.mockRejectedValue(
      new Error("io error"),
    );
    const report = await runDoctorFix({
      "settings-defaults": "backfill",
    });
    const fix = report.fixes.find(
      (f) => f.check === "settings-defaults",
    );
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("io error");
  });
});

describe("applyFix: repo-memory-managers no-change", () => {
  it("succeeds with no-change message", async () => {
    mockInspectMissingRepoMemoryManagerTypes.mockResolvedValue({
      missingRepoPaths: ["/a"], fileMissing: false,
    });
    mockBackfillMissingRepoMemoryManagerTypes.mockResolvedValue({
      changed: false, migratedRepoPaths: [],
    });
    const report = await runDoctorFix({
      "repo-memory-managers": "backfill",
    });
    const fix = report.fixes.find(
      (f) => f.check === "repo-memory-managers",
    );
    expect(fix?.success).toBe(true);
    expect(fix?.message).toContain("already present");
  });

  it("fails when backfill throws", async () => {
    mockInspectMissingRepoMemoryManagerTypes.mockResolvedValue({
      missingRepoPaths: ["/a"], fileMissing: false,
    });
    mockBackfillMissingRepoMemoryManagerTypes.mockRejectedValue(
      new Error("io error"),
    );
    const report = await runDoctorFix({
      "repo-memory-managers": "backfill",
    });
    const fix = report.fixes.find(
      (f) => f.check === "repo-memory-managers",
    );
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("io error");
  });
});

describe("applyFix: settings-stale-keys no-change", () => {
  it("succeeds with no-change message", async () => {
    mockInspectStaleSettingsKeys.mockResolvedValue({
      stalePaths: ["agent"], fileMissing: false,
    });
    mockCleanStaleSettingsKeys.mockResolvedValue({
      stalePaths: [], changed: false,
    });
    const report = await runDoctorFix({
      "settings-stale-keys": "clean",
    });
    const fix = report.fixes.find(
      (f) => f.check === "settings-stale-keys",
    );
    expect(fix?.success).toBe(true);
    expect(fix?.message).toContain("no changes needed");
  });

  it("fails when cleanup throws", async () => {
    mockInspectStaleSettingsKeys.mockResolvedValue({
      stalePaths: ["agent"], fileMissing: false,
    });
    mockCleanStaleSettingsKeys.mockRejectedValue(new Error("io error"));
    const report = await runDoctorFix({
      "settings-stale-keys": "clean",
    });
    const fix = report.fixes.find(
      (f) => f.check === "settings-stale-keys",
    );
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("io error");
  });
});

describe("applyFix: missing context", () => {
  it("returns failure when stale-parent update fails", async () => {
    const repos = [
      { path: "/repo", name: "repo", addedAt: "2026-01-01" },
    ];
    mockListRepos.mockResolvedValue(repos);
    mockList.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "parent-x", title: "P", state: "open",
          labels: [], type: "epic", priority: 2,
          created: "2026-01-01", updated: "2026-01-01",
        },
        {
          id: "child-x", title: "C", state: "closed",
          labels: [], type: "task", priority: 2,
          parent: "parent-x",
          created: "2026-01-01", updated: "2026-01-01",
        },
      ],
    });
    mockUpdate.mockResolvedValue({
      ok: false, error: { message: "not found" },
    });
    const report = await runDoctorFix({
      "stale-parent": "mark-in-progress",
    });
    const fix = report.fixes.find((f) => f.check === "stale-parent");
    expect(fix?.success).toBe(false);
    expect(fix?.message).toContain("not found");
  });
});
