/**
 * Doctor: streamDoctor, checkMemoryManagerCliAvailability, and
 * checkRegistryConsistency.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  mockList,
  mockGetRegisteredAgents,
  mockListRepos,
  mockGetReleaseVersionStatus,
  mockExecFile,
  mockDetectMemoryManagerType,
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
  checkMemoryManagerCliAvailability,
  checkRegistryConsistency,
  streamDoctor,
  type DoctorStreamEvent,
  type DoctorCheckResult,
  type DoctorStreamSummary,
} from "@/lib/doctor";

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultMocks();
});

// ── streamDoctor ────────────────────────────────────────

async function collectDoctorStream(): Promise<
  DoctorStreamEvent[]
> {
  const events: DoctorStreamEvent[] = [];
  for await (const event of streamDoctor()) {
    events.push(event);
  }
  return events;
}

describe("streamDoctor: event structure", () => {
  it("emits 12 check events plus 1 summary event", async () => {
    mockGetRegisteredAgents.mockResolvedValue({
      claude: { command: "claude", label: "Claude" },
    });
    mockExecFile.mockResolvedValue({
      stdout: "1.2.3", stderr: "",
    });
    mockListRepos.mockResolvedValue([]);
    mockGetReleaseVersionStatus.mockResolvedValue({
      installedVersion: "1.0.0",
      latestVersion: "1.0.0",
      updateAvailable: false,
    });

    const events = await collectDoctorStream();
    expect(events).toHaveLength(13);

    for (let i = 0; i < 12; i++) {
      const ev = events[i] as DoctorCheckResult;
      expect(ev.done).toBeUndefined();
      expect(ev.category).toBeTruthy();
      expect(ev.label).toBeTruthy();
      expect(
        ["pass", "fail", "warning"],
      ).toContain(ev.status);
      expect(typeof ev.summary).toBe("string");
      expect(Array.isArray(ev.diagnostics)).toBe(true);
    }

    const summary = events[12] as DoctorStreamSummary;
    expect(summary.done).toBe(true);
    expect(typeof summary.passed).toBe("number");
    expect(typeof summary.failed).toBe("number");
    expect(typeof summary.warned).toBe("number");
    expect(typeof summary.fixable).toBe("number");
  });

  it("emits events in correct category order", async () => {
    mockGetRegisteredAgents.mockResolvedValue({});
    mockListRepos.mockResolvedValue([]);

    const events = await collectDoctorStream();
    const categories = events
      .filter(
        (e): e is DoctorCheckResult =>
          !("done" in e && e.done),
      )
      .map((e) => e.category);

    expect(categories).toEqual([
      "agents",
      "updates",
      "config-permissions",
      "settings-defaults",
      "settings-stale-keys",
      "backend-type-migration",
      "repo-memory-managers",
      "memory-implementation",
      "stale-parents",
      "memory-manager-cli",
      "registry-consistency",
      "active-knots-leases",
    ]);
  });
});

describe("streamDoctor: status reporting", () => {
  it("reports fail status when agent check has errors", async () => {
    mockGetRegisteredAgents.mockResolvedValue({
      broken: { command: "broken-agent" },
    });
    mockExecFile.mockRejectedValue(
      new Error("command not found"),
    );
    mockListRepos.mockResolvedValue([]);

    const events = await collectDoctorStream();
    const agentEvent = events[0] as DoctorCheckResult;
    expect(agentEvent.category).toBe("agents");
    expect(agentEvent.status).toBe("fail");
    expect(agentEvent.summary).toContain("issue");
  });

  it("reports warning status when update is available", async () => {
    mockGetRegisteredAgents.mockResolvedValue({});
    mockListRepos.mockResolvedValue([]);
    mockGetReleaseVersionStatus.mockResolvedValue({
      installedVersion: "1.0.0",
      latestVersion: "2.0.0",
      updateAvailable: true,
    });

    const events = await collectDoctorStream();
    const updateEvent = events[1] as DoctorCheckResult;
    expect(updateEvent.category).toBe("updates");
    expect(updateEvent.status).toBe("warning");
  });

  it("counts fixable issues in summary", async () => {
    const repos = [{
      path: "/repo",
      name: "test-repo",
      addedAt: "2026-01-01",
    }];
    mockListRepos.mockResolvedValue(repos);
    mockGetRegisteredAgents.mockResolvedValue({});
    mockList.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "parent-1", title: "Parent",
          state: "open", labels: [], type: "epic",
          priority: 2,
          created: "2026-01-01", updated: "2026-01-01",
        },
        {
          id: "child-1", title: "Child",
          state: "closed", labels: [], type: "task",
          priority: 2, parent: "parent-1",
          created: "2026-01-01", updated: "2026-01-01",
        },
      ],
    });

    const events = await collectDoctorStream();
    const summary = events[
      events.length - 1
    ] as DoctorStreamSummary;
    expect(summary.done).toBe(true);
    expect(summary.fixable).toBe(1);
    expect(summary.warned).toBeGreaterThanOrEqual(1);
  });
});

// ── checkMemoryManagerCliAvailability ──────────────────────

describe("checkMemoryManagerCliAvailability: reachable", () => {
  const repos = [
    {
      path: "/repo-knots",
      name: "knots-repo",
      addedAt: "2026-01-01",
      memoryManagerType: "knots" as const,
    },
    {
      path: "/repo-beads",
      name: "beads-repo",
      addedAt: "2026-01-01",
      memoryManagerType: "beads" as const,
    },
  ];

  it("reports info when CLI is reachable", async () => {
    mockExecFile.mockResolvedValue({
      stdout: "1.0.0", stderr: "",
    });

    const diags = await checkMemoryManagerCliAvailability(
      repos,
    );
    expect(diags).toHaveLength(2);
    expect(
      diags.every((d) => d.severity === "info"),
    ).toBe(true);
    expect(
      diags.every(
        (d) => d.check === "memory-manager-cli",
      ),
    ).toBe(true);
  });

  it("reports error when CLI is unreachable", async () => {
    mockExecFile.mockRejectedValue(
      new Error("command not found"),
    );

    const diags = await checkMemoryManagerCliAvailability(
      repos,
    );
    expect(diags).toHaveLength(2);
    expect(
      diags.every((d) => d.severity === "error"),
    ).toBe(true);
    expect(diags[0].message).toContain("unreachable");
  });
});

describe("checkMemoryManagerCliAvailability: caching", () => {
  it("caches ping results per binary", async () => {
    const sameTypeRepos = [
      {
        path: "/repo-a",
        name: "repo-a",
        addedAt: "2026-01-01",
        memoryManagerType: "knots" as const,
      },
      {
        path: "/repo-b",
        name: "repo-b",
        addedAt: "2026-01-01",
        memoryManagerType: "knots" as const,
      },
    ];
    mockExecFile.mockResolvedValue({
      stdout: "1.0.0", stderr: "",
    });

    await checkMemoryManagerCliAvailability(sameTypeRepos);
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it("skips repos without memoryManagerType", async () => {
    const noTypeRepos = [{
      path: "/repo",
      name: "untyped",
      addedAt: "2026-01-01",
    }];

    const diags = await checkMemoryManagerCliAvailability(
      noTypeRepos,
    );
    expect(diags).toHaveLength(0);
  });
});

// ── checkRegistryConsistency ──────────────────────────────

describe("checkRegistryConsistency: match and mismatch", () => {
  it("reports info when registered type matches detected type", async () => {
    const repos = [{
      path: "/repo",
      name: "test-repo",
      addedAt: "2026-01-01",
      memoryManagerType: "knots" as const,
    }];
    mockDetectMemoryManagerType.mockReturnValue("knots");

    const diags = await checkRegistryConsistency(repos);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("info");
    expect(diags[0].check).toBe("registry-consistency");
    expect(diags[0].message).toContain("matches");
  });

  it("warns when registered type differs from detected type", async () => {
    const repos = [{
      path: "/repo",
      name: "test-repo",
      addedAt: "2026-01-01",
      memoryManagerType: "beads" as const,
    }];
    mockDetectMemoryManagerType.mockReturnValue("knots");

    const diags = await checkRegistryConsistency(repos);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].check).toBe("registry-consistency");
    expect(diags[0].fixable).toBe(true);
    expect(diags[0].fixOptions).toEqual([
      {
        key: "sync",
        label:
          "Update registry to match detected type",
      },
    ]);
    expect(diags[0].message).toContain("beads");
    expect(diags[0].message).toContain("knots");
  });
});

describe("checkRegistryConsistency: undetectable repos", () => {
  it("reports info when repo cannot be detected on disk", async () => {
    const repos = [{
      path: "/nonexistent",
      name: "gone-repo",
      addedAt: "2026-01-01",
      memoryManagerType: "knots" as const,
    }];
    mockDetectMemoryManagerType.mockReturnValue(undefined);

    const diags = await checkRegistryConsistency(repos);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("info");
    expect(diags[0].message).toContain(
      "could not be detected",
    );
  });
});
