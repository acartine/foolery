/**
 * Doctor: individual check functions (checkConfigPermissions,
 * checkSettingsDefaults, checkStaleSettingsKeys,
 * checkBackendTypeMigration, checkRepoMemoryManagerTypes,
 * checkAgents, checkUpdates, checkStaleParents).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  mockList,
  mockGetRegisteredAgents,
  mockLoadSettings,
  mockInspectSettingsDefaults,
  mockInspectStaleSettingsKeys,
  mockInspectMissingRepoMemoryManagerTypes,
  mockInspectRegistryPermissions,
  mockGetReleaseVersionStatus,
  mockExecFile,
  DEFAULT_SETTINGS,
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
  checkAgents,
  checkUpdates,
  checkConfigPermissions,
  checkSettingsDefaults,
  checkStaleSettingsKeys,
  checkBackendTypeMigration,
  checkRepoMemoryManagerTypes,
  checkStaleParents,
} from "@/lib/doctor";

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultMocks();
});

describe("checkConfigPermissions", () => {
  it("reports info when config permissions are already restricted", async () => {
    const diags = await checkConfigPermissions();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("info");
    expect(diags[0].check).toBe("config-permissions");
    expect(diags[0].fixable).toBe(false);
  });

  it("reports warning and fix option when a config file is too permissive", async () => {
    mockInspectRegistryPermissions.mockResolvedValue({
      fileMissing: false,
      needsFix: true,
      actualMode: 0o644,
    });

    const diags = await checkConfigPermissions();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].check).toBe("config-permissions");
    expect(diags[0].fixable).toBe(true);
    expect(diags[0].fixOptions).toEqual([
      {
        key: "restrict",
        label: "Restrict config file permissions to 0600",
      },
    ]);
    expect(diags[0].message).toContain("registry.json");
    expect(diags[0].message).toContain("0644");
  });
});

describe("checkSettingsDefaults", () => {
  it("reports info when settings defaults are present", async () => {
    mockInspectSettingsDefaults.mockResolvedValue({
      settings: DEFAULT_SETTINGS,
      missingPaths: [],
      fileMissing: false,
    });
    const diags = await checkSettingsDefaults();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("info");
    expect(diags[0].check).toBe("settings-defaults");
    expect(diags[0].fixable).toBe(false);
  });

  it("reports warning and fix option when settings are missing", async () => {
    mockInspectSettingsDefaults.mockResolvedValue({
      settings: DEFAULT_SETTINGS,
      missingPaths: ["defaults.profileId", "backend.type"],
      fileMissing: false,
    });
    const diags = await checkSettingsDefaults();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].check).toBe("settings-defaults");
    expect(diags[0].fixable).toBe(true);
    expect(diags[0].fixOptions).toEqual([
      {
        key: "backfill",
        label: "Backfill missing settings defaults",
      },
    ]);
  });
});

describe("checkStaleSettingsKeys", () => {
  it("reports warning and fix option when stale keys are present", async () => {
    mockInspectStaleSettingsKeys.mockResolvedValue({
      stalePaths: ["agent", "verification", "actions.direct"],
      fileMissing: false,
    });

    const diags = await checkStaleSettingsKeys();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].check).toBe("settings-stale-keys");
    expect(diags[0].fixable).toBe(true);
    expect(diags[0].fixOptions).toEqual([
      {
        key: "clean",
        label: "Remove stale settings keys",
      },
    ]);
  });
});

describe("checkBackendTypeMigration", () => {
  it("warns when backend.type is cli", async () => {
    mockLoadSettings.mockResolvedValue({
      backend: { type: "cli" },
    });
    const diags = await checkBackendTypeMigration();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].check).toBe("backend-type-migration");
    expect(diags[0].fixable).toBe(true);
    expect(diags[0].message).toContain("cli");
    expect(diags[0].message).toContain("auto");
  });

  it("passes when backend.type is auto", async () => {
    mockLoadSettings.mockResolvedValue({
      backend: { type: "auto" },
    });
    const diags = await checkBackendTypeMigration();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("info");
    expect(diags[0].fixable).toBe(false);
  });

  it("passes for other backend types", async () => {
    mockLoadSettings.mockResolvedValue({
      backend: { type: "knots" },
    });
    const diags = await checkBackendTypeMigration();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("info");
    expect(diags[0].message).toContain("knots");
  });

  it("handles loadSettings failure gracefully", async () => {
    mockLoadSettings.mockRejectedValue(
      new Error("read error"),
    );
    const diags = await checkBackendTypeMigration();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].fixable).toBe(false);
  });
});

describe("checkRepoMemoryManagerTypes", () => {
  it("reports info when repo memory manager metadata is present", async () => {
    mockInspectMissingRepoMemoryManagerTypes
      .mockResolvedValue({
        missingRepoPaths: [],
        fileMissing: false,
      });
    const diags = await checkRepoMemoryManagerTypes();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("info");
    expect(diags[0].check).toBe("repo-memory-managers");
    expect(diags[0].fixable).toBe(false);
  });

  it("reports warning and fix option when repo memory manager metadata is missing", async () => {
    mockInspectMissingRepoMemoryManagerTypes
      .mockResolvedValue({
        missingRepoPaths: ["/repo-a", "/repo-b"],
        fileMissing: false,
      });
    const diags = await checkRepoMemoryManagerTypes();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].check).toBe("repo-memory-managers");
    expect(diags[0].fixable).toBe(true);
    expect(diags[0].fixOptions).toEqual([
      {
        key: "backfill",
        label:
          "Backfill missing repository"
          + " memory manager metadata",
      },
    ]);
  });
});

describe("checkAgents", () => {
  it("warns when no agents are registered", async () => {
    mockGetRegisteredAgents.mockResolvedValue({});
    const diags = await checkAgents();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].message).toContain(
      "No agents registered",
    );
  });

  it("reports healthy agent when --version succeeds", async () => {
    mockGetRegisteredAgents.mockResolvedValue({
      claude: { command: "claude", label: "Claude" },
    });
    mockExecFile.mockResolvedValue({
      stdout: "1.2.3", stderr: "",
    });

    const diags = await checkAgents();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("info");
    expect(diags[0].message).toContain("healthy");
  });

  it("reports error when agent --version fails", async () => {
    mockGetRegisteredAgents.mockResolvedValue({
      broken: { command: "broken-agent" },
    });
    mockExecFile.mockRejectedValue(
      new Error("command not found"),
    );

    const diags = await checkAgents();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message).toContain("unreachable");
  });

  it("reports error when agent returns garbage", async () => {
    mockGetRegisteredAgents.mockResolvedValue({
      garbage: { command: "garbage-agent" },
    });
    mockExecFile.mockResolvedValue({
      stdout: "no version here", stderr: "",
    });

    const diags = await checkAgents();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message).toContain(
      "Unexpected response",
    );
  });
});

describe("checkUpdates", () => {
  it("reports info when up to date", async () => {
    mockGetReleaseVersionStatus.mockResolvedValue({
      installedVersion: "1.0.0",
      latestVersion: "1.0.0",
      updateAvailable: false,
    });
    const diags = await checkUpdates();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("info");
    expect(diags[0].message).toContain("up to date");
  });

  it("reports warning when update is available", async () => {
    mockGetReleaseVersionStatus.mockResolvedValue({
      installedVersion: "1.0.0",
      latestVersion: "1.1.0",
      updateAvailable: true,
    });
    const diags = await checkUpdates();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].message).toContain("Update available");
  });
});

describe("checkStaleParents", () => {
  const repos = [{
    path: "/repo",
    name: "test-repo",
    addedAt: "2026-01-01",
  }];

  it("detects parent with all children closed", async () => {
    mockList.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "parent-1", title: "Epic",
          state: "open", labels: [], type: "epic",
          priority: 2,
          created: "2026-01-01", updated: "2026-01-01",
        },
        {
          id: "child-1", title: "Task 1",
          state: "closed", labels: [], type: "task",
          priority: 2, parent: "parent-1",
          created: "2026-01-01", updated: "2026-01-01",
        },
        {
          id: "child-2", title: "Task 2",
          state: "closed", labels: [], type: "task",
          priority: 2, parent: "parent-1",
          created: "2026-01-01", updated: "2026-01-01",
        },
      ],
    });
    const diags = await checkStaleParents(repos);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].check).toBe("stale-parent");
    expect(diags[0].fixable).toBe(true);
    expect(diags[0].context?.beatId).toBe("parent-1");
  });

  it("ignores parent when some children are open", async () => {
    mockList.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "parent-1", title: "Epic",
          state: "open", labels: [], type: "epic",
          priority: 2,
          created: "2026-01-01", updated: "2026-01-01",
        },
        {
          id: "child-1", title: "Task 1",
          state: "closed", labels: [], type: "task",
          priority: 2, parent: "parent-1",
          created: "2026-01-01", updated: "2026-01-01",
        },
        {
          id: "child-2", title: "Task 2",
          state: "open", labels: [], type: "task",
          priority: 2, parent: "parent-1",
          created: "2026-01-01", updated: "2026-01-01",
        },
      ],
    });
    const diags = await checkStaleParents(repos);
    expect(diags).toHaveLength(0);
  });

  it("ignores already-closed parent", async () => {
    mockList.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "parent-1", title: "Epic",
          state: "closed", labels: [], type: "epic",
          priority: 2,
          created: "2026-01-01", updated: "2026-01-01",
        },
        {
          id: "child-1", title: "Task 1",
          state: "closed", labels: [], type: "task",
          priority: 2, parent: "parent-1",
          created: "2026-01-01", updated: "2026-01-01",
        },
      ],
    });
    const diags = await checkStaleParents(repos);
    expect(diags).toHaveLength(0);
  });
});
