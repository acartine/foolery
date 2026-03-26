/**
 * Doctor: runDoctor and runDoctorFix.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  mockList,
  mockUpdate,
  mockGetRegisteredAgents,
  mockLoadSettings,
  mockUpdateSettings,
  mockListRepos,
  mockGetReleaseVersionStatus,
  mockDetectMemoryManagerType,
  mockUpdateRegisteredRepoMemoryManagerType,
  setupDefaultMocks,
} from "./doctor-mocks";

vi.mock("@/lib/backend-instance", async () => {
  const m = await import("./doctor-mocks");
  return m.buildBackendMock();
});

vi.mock("@/lib/settings", async () => {
  const m = await import("./doctor-mocks");
  return m.buildSettingsMock();
});

vi.mock("@/lib/registry", async () => {
  const m = await import("./doctor-mocks");
  return m.buildRegistryMock();
});

vi.mock("@/lib/release-version", async () => {
  const m = await import("./doctor-mocks");
  return m.buildReleaseVersionMock();
});

vi.mock("node:child_process", async () => {
  const m = await import("./doctor-mocks");
  return m.buildChildProcessMock();
});

vi.mock("@/lib/memory-manager-detection", async () => {
  const m = await import("./doctor-mocks");
  return m.buildMemoryManagerDetectionMock();
});

import {
  runDoctor,
  runDoctorFix,
} from "@/lib/doctor";

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultMocks();
});

// ── runDoctor ──────────────────────────────────────────────

describe("runDoctor", () => {
  it("returns a report with all check categories", async () => {
    mockGetRegisteredAgents.mockResolvedValue({});
    mockListRepos.mockResolvedValue([]);
    mockGetReleaseVersionStatus.mockResolvedValue({
      installedVersion: "1.0.0",
      latestVersion: "1.0.0",
      updateAvailable: false,
    });

    const report = await runDoctor();
    expect(report.timestamp).toBeTruthy();
    expect(report.diagnostics).toBeInstanceOf(Array);
    expect(report.summary).toHaveProperty("errors");
    expect(report.summary).toHaveProperty("warnings");
    expect(report.summary).toHaveProperty("fixable");
  });
});

// ── runDoctorFix ───────────────────────────────────────────

describe("runDoctorFix: stale parent and backend", () => {
    const staleParentData = {
    ok: true,
    data: [
      {
        id: "parent-fix", title: "Parent",
        state: "open", labels: [], type: "epic",
        priority: 2,
        created: "2026-01-01", updated: "2026-01-01",
      },
      {
        id: "child-fix", title: "Child",
        state: "closed", labels: [], type: "task",
        priority: 2, parent: "parent-fix",
        created: "2026-01-01", updated: "2026-01-01",
      },
    ],
  };

  function setupStaleParent() {
    const repos = [{
      path: "/repo",
      name: "test-repo",
      addedAt: "2026-01-01",
    }];
    mockListRepos.mockResolvedValue(repos);
    mockGetRegisteredAgents.mockResolvedValue({});
    mockList.mockResolvedValue(staleParentData);
    mockUpdate.mockResolvedValue({ ok: true });
  }

  it("fixes stale parent with default strategy", async () => {
    setupStaleParent();

    const fixReport = await runDoctorFix({
      "stale-parent": "mark-in-progress",
    });
    expect(
      fixReport.fixes.length,
    ).toBeGreaterThanOrEqual(1);
    const staleFix = fixReport.fixes.find(
      (f) => f.check === "stale-parent",
    );
    expect(staleFix?.success).toBe(true);
    expect(staleFix?.message).toContain(
      "state=in_progress",
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      "parent-fix",
      { state: "in_progress" },
      "/repo",
    );
  });

  it("skips checks not included in strategies", async () => {
    setupStaleParent();

    const fixReport = await runDoctorFix({});
    expect(fixReport.fixes).toHaveLength(0);
    expect(fixReport.summary.attempted).toBe(0);
  });

  it("fixes backend-type-migration by updating settings to auto", async () => {
    mockLoadSettings.mockResolvedValue({
      backend: { type: "cli" },
    });
    mockListRepos.mockResolvedValue([]);
    mockGetRegisteredAgents.mockResolvedValue({});
    mockUpdateSettings.mockResolvedValue({
      backend: { type: "auto" },
    });

    const fixReport = await runDoctorFix({
      "backend-type-migration": "migrate",
    });
    const btFix = fixReport.fixes.find(
      (f) => f.check === "backend-type-migration",
    );
    expect(btFix?.success).toBe(true);
    expect(btFix?.message).toContain("Migrated");
    expect(mockUpdateSettings).toHaveBeenCalledWith({
      backend: { type: "auto" },
    });
  });

});

describe("runDoctorFix: registry consistency", () => {
    it("fixes registry-consistency by syncing memory manager type", async () => {
    const repos = [{
      path: "/repo",
      name: "test-repo",
      addedAt: "2026-01-01",
      memoryManagerType: "beads" as const,
    }];
    mockListRepos.mockResolvedValue(repos);
    mockGetRegisteredAgents.mockResolvedValue({});
    mockDetectMemoryManagerType.mockReturnValue("knots");
    mockUpdateRegisteredRepoMemoryManagerType
      .mockResolvedValue({
        changed: true,
        fileMissing: false,
        repoFound: true,
        previousMemoryManagerType: "beads",
        memoryManagerType: "knots",
      });

    const fixReport = await runDoctorFix({
      "registry-consistency": "sync",
    });
    const rcFix = fixReport.fixes.find(
      (f) => f.check === "registry-consistency",
    );
    expect(rcFix).toBeDefined();
    expect(rcFix?.success).toBe(true);
    expect(rcFix?.message).toContain("knots");
    expect(
      mockUpdateRegisteredRepoMemoryManagerType,
    ).toHaveBeenCalledWith("/repo", "knots");
  });

  it("reports failure when registry-consistency sync finds no repo", async () => {
    const repos = [{
      path: "/repo",
      name: "test-repo",
      addedAt: "2026-01-01",
      memoryManagerType: "beads" as const,
    }];
    mockListRepos.mockResolvedValue(repos);
    mockGetRegisteredAgents.mockResolvedValue({});
    mockDetectMemoryManagerType.mockReturnValue("knots");
    mockUpdateRegisteredRepoMemoryManagerType
      .mockResolvedValue({
        changed: false,
        fileMissing: false,
        repoFound: false,
      });

    const fixReport = await runDoctorFix({
      "registry-consistency": "sync",
    });
    const rcFix = fixReport.fixes.find(
      (f) => f.check === "registry-consistency",
    );
    expect(rcFix).toBeDefined();
    expect(rcFix?.success).toBe(false);
    expect(rcFix?.message).toContain("no longer registered");
  });

});

describe("runDoctorFix: backwards compatibility", () => {
    const staleParentData = {
      ok: true,
      data: [
        {
          id: "parent-fix", title: "Parent",
          state: "open", labels: [], type: "epic",
          priority: 2,
          created: "2026-01-01", updated: "2026-01-01",
        },
        {
          id: "child-fix", title: "Child",
          state: "closed", labels: [], type: "task",
          priority: 2, parent: "parent-fix",
          created: "2026-01-01", updated: "2026-01-01",
        },
      ],
    };

    function setupStaleParent() {
      const repos = [{
        path: "/repo",
        name: "test-repo",
        addedAt: "2026-01-01",
      }];
      mockListRepos.mockResolvedValue(repos);
      mockGetRegisteredAgents.mockResolvedValue({});
      mockList.mockResolvedValue(staleParentData);
      mockUpdate.mockResolvedValue({ ok: true });
    }

    it("uses default first option when no strategies provided (backwards compat)", async () => {
      setupStaleParent();

      const fixReport = await runDoctorFix();
      expect(
        fixReport.fixes.length,
      ).toBeGreaterThanOrEqual(1);
      const staleFix = fixReport.fixes.find(
        (f) => f.check === "stale-parent",
      );
      expect(staleFix?.success).toBe(true);
    });
});

