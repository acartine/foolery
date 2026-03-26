/**
 * Doctor coverage tests: diagnostic checks.
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

const mockGetRegisteredAgents = vi.fn();
const mockInspectSettingsDefaults = vi.fn();
const mockInspectStaleSettingsKeys = vi.fn();
const mockInspectSettingsPermissions = vi.fn();
vi.mock("@/lib/settings", () => ({
  getRegisteredAgents: () => mockGetRegisteredAgents(),
  inspectSettingsDefaults: () => mockInspectSettingsDefaults(),
  inspectStaleSettingsKeys: () => mockInspectStaleSettingsKeys(),
  backfillMissingSettingsDefaults: vi.fn(),
  inspectSettingsPermissions: () => mockInspectSettingsPermissions(),
  ensureSettingsPermissions: vi.fn(),
  cleanStaleSettingsKeys: vi.fn(),
}));

const mockListRepos = vi.fn();
const mockInspectMissingRepoMemoryManagerTypes = vi.fn();
const mockInspectRegistryPermissions = vi.fn();
vi.mock("@/lib/registry", () => ({
  listRepos: () => mockListRepos(),
  inspectMissingRepoMemoryManagerTypes: () =>
    mockInspectMissingRepoMemoryManagerTypes(),
  backfillMissingRepoMemoryManagerTypes: vi.fn(),
  inspectRegistryPermissions: () => mockInspectRegistryPermissions(),
  ensureRegistryPermissions: vi.fn(),
}));

const mockGetReleaseVersionStatus = vi.fn();
vi.mock("@/lib/release-version", () => ({
  getReleaseVersionStatus: () => mockGetReleaseVersionStatus(),
}));

const mockListLeases = vi.fn();
vi.mock("@/lib/knots", () => ({
  listLeases: (...args: unknown[]) => mockListLeases(...args),
}));

const mockLogLeaseAudit = vi.fn();
vi.mock("@/lib/lease-audit", () => ({
  logLeaseAudit: (...args: unknown[]) => mockLogLeaseAudit(...args),
}));

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === "function") {
      cb(null, "", "");
    }
  },
}));

const mockDetectMemoryManagerType = vi.fn();
vi.mock("@/lib/memory-manager-detection", () => ({
  detectMemoryManagerType: (...args: unknown[]) =>
    mockDetectMemoryManagerType(...args),
}));

import {
  checkMemoryImplementationCompatibility,
  checkStaleParents,
  checkConfigPermissions,
  checkSettingsDefaults,
  checkStaleSettingsKeys,
  checkRepoMemoryManagerTypes,
  checkActiveKnotsLeases,
  streamDoctor,
  type DoctorCheckResult,
  type DoctorStreamSummary,
} from "@/lib/doctor";

beforeEach(() => {
  vi.clearAllMocks();
  mockListRepos.mockResolvedValue([]);
  mockGetRegisteredAgents.mockResolvedValue({});
  mockListWorkflows.mockResolvedValue({ ok: true, data: [] });
  mockInspectSettingsDefaults.mockResolvedValue({
    missingPaths: [], fileMissing: false,
  });
  mockInspectStaleSettingsKeys.mockResolvedValue({
    stalePaths: [], fileMissing: false,
  });
  mockInspectSettingsPermissions.mockResolvedValue({
    fileMissing: false, needsFix: false, actualMode: 0o600,
  });
  mockInspectMissingRepoMemoryManagerTypes.mockResolvedValue({
    missingRepoPaths: [], fileMissing: false,
  });
  mockInspectRegistryPermissions.mockResolvedValue({
    fileMissing: false, needsFix: false, actualMode: 0o600,
  });
  mockGetReleaseVersionStatus.mockResolvedValue({
    installedVersion: "1.0.0", latestVersion: "1.0.0",
    updateAvailable: false,
  });
  mockDetectMemoryManagerType.mockReturnValue(undefined);
  mockListLeases.mockResolvedValue({ ok: true, data: [] });
});

describe("checkMemoryImplementationCompatibility", () => {
  it("errors when no memory manager marker exists for repo", async () => {
    mockDetectMemoryManagerType.mockReturnValue(undefined);
    const repos = [
      { path: "/no-marker", name: "no-marker", addedAt: "2026-01-01" },
    ];
    const diags = await checkMemoryImplementationCompatibility(repos);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message).toContain("missing a compatible memory manager");
  });

  it("warns when detected but workflows list empty", async () => {
    mockDetectMemoryManagerType.mockReturnValue("knots");
    mockListWorkflows.mockResolvedValue({ ok: true, data: [] });
    const repos = [
      { path: "/repo-k", name: "knots-repo", addedAt: "2026-01-01" },
    ];
    const diags = await checkMemoryImplementationCompatibility(repos);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].message).toContain("could not enumerate workflows");
  });

  it("reports info when workflows are present", async () => {
    mockDetectMemoryManagerType.mockReturnValue("beads");
    mockListWorkflows.mockResolvedValue({
      ok: true,
      data: [
        { id: "w1", mode: "granular_autonomous" },
        { id: "w2", mode: "coarse_human_gated" },
      ],
    });
    const repos = [
      { path: "/repo-b", name: "beads-repo", addedAt: "2026-01-01" },
    ];
    const diags = await checkMemoryImplementationCompatibility(repos);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("info");
    expect(diags[0].message).toContain("2 workflows");
  });

  it("handles listWorkflows returning not-ok", async () => {
    mockDetectMemoryManagerType.mockReturnValue("beads");
    mockListWorkflows.mockResolvedValue({ ok: false });
    const repos = [
      { path: "/repo-fail", name: "fail-repo", addedAt: "2026-01-01" },
    ];
    const diags = await checkMemoryImplementationCompatibility(repos);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
  });
});

describe("checkConfigPermissions", () => {
  it("warns when permission inspection returns an error", async () => {
    mockInspectRegistryPermissions.mockResolvedValue({
      fileMissing: false, needsFix: false,
      error: "permission denied",
    });
    const diags = await checkConfigPermissions();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].message).toContain("permission denied");
    expect(diags[0].fixable).toBe(false);
  });
});

describe("checkActiveKnotsLeases", () => {
  it("reports info when a knots repo has no active leases", async () => {
    mockListLeases.mockResolvedValue({ ok: true, data: [] });
    const diags = await checkActiveKnotsLeases([
      {
        path: "/repo-k", name: "knots-repo",
        addedAt: "2026-01-01", memoryManagerType: "knots",
      },
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("info");
    expect(diags[0].message).toContain("no active Knots leases");
  });

  it("reports warning when active leases exist", async () => {
    mockListLeases.mockResolvedValue({
      ok: true, data: [{ id: "lease-1" }, { id: "lease-2" }],
    });
    const diags = await checkActiveKnotsLeases([
      {
        path: "/repo-k", name: "knots-repo",
        addedAt: "2026-01-01", memoryManagerType: "knots",
      },
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].message).toContain("2 active Knots leases");
    expect(mockLogLeaseAudit).toHaveBeenCalledWith(expect.objectContaining({
      event: "orphan_leases_detected",
      repoPath: "/repo-k", outcome: "warning",
    }));
  });
});

describe("checkSettingsDefaults", () => {
  it("warns when inspectSettingsDefaults returns an error", async () => {
    mockInspectSettingsDefaults.mockResolvedValue({
      error: "disk full", missingPaths: [], fileMissing: false,
    });
    const diags = await checkSettingsDefaults();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].message).toContain("disk full");
    expect(diags[0].fixable).toBe(false);
  });

  it("reports warning for file-missing case", async () => {
    mockInspectSettingsDefaults.mockResolvedValue({
      missingPaths: [], fileMissing: true,
    });
    const diags = await checkSettingsDefaults();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].fixable).toBe(true);
    expect(diags[0].message).toContain("missing and should be created");
  });

  it("summarizes more than 4 missing settings with +N more", async () => {
    mockInspectSettingsDefaults.mockResolvedValue({
      missingPaths: ["a.b", "c.d", "e.f", "g.h", "i.j", "k.l"],
      fileMissing: false,
    });
    const diags = await checkSettingsDefaults();
    expect(diags[0].message).toContain("+2 more");
  });
});

describe("checkRepoMemoryManagerTypes", () => {
  it("reports info when registry file does not exist", async () => {
    mockInspectMissingRepoMemoryManagerTypes.mockResolvedValue({
      missingRepoPaths: [], fileMissing: true,
    });
    const diags = await checkRepoMemoryManagerTypes();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("info");
    expect(diags[0].message).toContain("does not exist");
  });

  it("reports error when inspectMissing returns an error", async () => {
    mockInspectMissingRepoMemoryManagerTypes.mockResolvedValue({
      error: "permission denied", missingRepoPaths: [], fileMissing: false,
    });
    const diags = await checkRepoMemoryManagerTypes();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].message).toContain("permission denied");
  });

  it("summarizes more than 3 missing repos with +N more", async () => {
    mockInspectMissingRepoMemoryManagerTypes.mockResolvedValue({
      missingRepoPaths: ["/a", "/b", "/c", "/d", "/e"],
      fileMissing: false,
    });
    const diags = await checkRepoMemoryManagerTypes();
    expect(diags[0].message).toContain("+2 more");
  });
});

describe("checkStaleSettingsKeys", () => {
  it("returns info when no stale settings keys are present", async () => {
    mockInspectStaleSettingsKeys.mockResolvedValue({
      stalePaths: [], fileMissing: false,
    });
    const diags = await checkStaleSettingsKeys();
    expect(diags).toHaveLength(1);
    expect(diags[0]?.severity).toBe("info");
  });

  it("returns non-fixable warning when inspection fails", async () => {
    mockInspectStaleSettingsKeys.mockResolvedValue({
      stalePaths: [], fileMissing: false, error: "parse failed",
    });
    const diags = await checkStaleSettingsKeys();
    expect(diags[0]?.fixable).toBe(false);
    expect(diags[0]?.message).toContain("parse failed");
  });
});

describe("checkStaleParents", () => {
  it("continues silently when list call throws", async () => {
    mockList.mockRejectedValue(new Error("backend down"));
    const repos = [
      { path: "/repo", name: "repo", addedAt: "2026-01-01" },
    ];
    const diags = await checkStaleParents(repos);
    expect(diags).toHaveLength(0);
  });

  it("skips deferred parent", async () => {
    mockList.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "parent-1", title: "P", state: "deferred",
          labels: [], type: "epic", priority: 2,
          created: "2026-01-01", updated: "2026-01-01",
        },
        {
          id: "child-1", title: "C", state: "closed",
          labels: [], type: "task", priority: 2,
          parent: "parent-1",
          created: "2026-01-01", updated: "2026-01-01",
        },
      ],
    });
    const repos = [
      { path: "/repo", name: "repo", addedAt: "2026-01-01" },
    ];
    const diags = await checkStaleParents(repos);
    expect(diags).toHaveLength(0);
  });
});

describe("streamDoctor", () => {
  it("handles check that throws into error diagnostic", async () => {
    mockGetRegisteredAgents.mockRejectedValue(
      new Error("agent check boom"),
    );
    mockListRepos.mockResolvedValue([]);
    const events = [];
    for await (const ev of streamDoctor()) {
      events.push(ev);
    }
    const agentEvent = events[0] as DoctorCheckResult;
    expect(agentEvent.category).toBe("agents");
    expect(agentEvent.status).toBe("fail");
    expect(agentEvent.diagnostics[0].message).toContain("agent check boom");

    const summary = events[events.length - 1] as DoctorStreamSummary;
    expect(summary.done).toBe(true);
    expect(summary.failed).toBeGreaterThanOrEqual(1);
  });
});
