import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
const mockBackfillMissingSettingsDefaults = vi.fn();
vi.mock("@/lib/settings", () => ({
  getRegisteredAgents: () => mockGetRegisteredAgents(),
  scanForAgents: () => mockScanForAgents(),
  loadSettings: () => mockLoadSettings(),
  inspectSettingsDefaults: () => mockInspectSettingsDefaults(),
  backfillMissingSettingsDefaults: () => mockBackfillMissingSettingsDefaults(),
}));

const mockListRepos = vi.fn();
const mockInspectMissingRepoMemoryManagerTypes = vi.fn();
const mockBackfillMissingRepoMemoryManagerTypes = vi.fn();
vi.mock("@/lib/registry", () => ({
  listRepos: () => mockListRepos(),
  inspectMissingRepoMemoryManagerTypes: () => mockInspectMissingRepoMemoryManagerTypes(),
  backfillMissingRepoMemoryManagerTypes: () => mockBackfillMissingRepoMemoryManagerTypes(),
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

import {
  checkAgents,
  checkUpdates,
  checkSettingsDefaults,
  checkRepoMemoryManagerTypes,
  checkCorruptTickets,
  checkStaleParents,
  checkPromptGuidance,
  runDoctor,
  runDoctorFix,
  streamDoctor,
  type DoctorStreamEvent,
  type DoctorCheckResult,
  type DoctorStreamSummary,
} from "@/lib/doctor";

const DEFAULT_SETTINGS = {
  agent: { command: "claude" },
  agents: {},
  actions: {
    take: "",
    scene: "",
    direct: "",
    breakdown: "",
  },
  verification: { enabled: false, agent: "", maxRetries: 3 },
  backend: { type: "auto" as const },
  workflow: { coarsePrPreferenceOverrides: {} },
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
        label: "Beads (Coarse)",
        mode: "coarse_human_gated",
        initialState: "open",
        states: ["open", "in_progress", "verification", "retake", "closed"],
        terminalStates: ["closed"],
        finalCutState: "verification",
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
  mockBackfillMissingSettingsDefaults.mockResolvedValue({
    settings: DEFAULT_SETTINGS,
    missingPaths: [],
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
  mockGetReleaseVersionStatus.mockResolvedValue({
    installedVersion: "1.0.0",
    latestVersion: "1.0.0",
    updateAvailable: false,
  });
});

// ── checkSettingsDefaults ─────────────────────────────────

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
      missingPaths: ["verification.enabled", "verification.agent"],
      fileMissing: false,
    });
    const diags = await checkSettingsDefaults();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].check).toBe("settings-defaults");
    expect(diags[0].fixable).toBe(true);
    expect(diags[0].fixOptions).toEqual([
      { key: "backfill", label: "Backfill missing settings defaults" },
    ]);
  });
});

// ── checkRepoMemoryManagerTypes ─────────────────────────────────

describe("checkRepoMemoryManagerTypes", () => {
  it("reports info when repo memory manager metadata is present", async () => {
    mockInspectMissingRepoMemoryManagerTypes.mockResolvedValue({
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
    mockInspectMissingRepoMemoryManagerTypes.mockResolvedValue({
      missingRepoPaths: ["/repo-a", "/repo-b"],
      fileMissing: false,
    });
    const diags = await checkRepoMemoryManagerTypes();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].check).toBe("repo-memory-managers");
    expect(diags[0].fixable).toBe(true);
    expect(diags[0].fixOptions).toEqual([
      { key: "backfill", label: "Backfill missing repository memory manager metadata" },
    ]);
  });
});

// ── checkAgents ────────────────────────────────────────────

describe("checkAgents", () => {
  it("warns when no agents are registered", async () => {
    mockGetRegisteredAgents.mockResolvedValue({});
    const diags = await checkAgents();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].message).toContain("No agents registered");
  });

  it("reports healthy agent when --version succeeds", async () => {
    mockGetRegisteredAgents.mockResolvedValue({
      claude: { command: "claude", label: "Claude" },
    });
    mockExecFile.mockResolvedValue({ stdout: "1.2.3", stderr: "" });

    const diags = await checkAgents();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("info");
    expect(diags[0].message).toContain("healthy");
  });

  it("reports error when agent --version fails", async () => {
    mockGetRegisteredAgents.mockResolvedValue({
      broken: { command: "broken-agent" },
    });
    mockExecFile.mockRejectedValue(new Error("command not found"));

    const diags = await checkAgents();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message).toContain("unreachable");
  });

  it("reports error when agent returns garbage", async () => {
    mockGetRegisteredAgents.mockResolvedValue({
      garbage: { command: "garbage-agent" },
    });
    mockExecFile.mockResolvedValue({ stdout: "no version here", stderr: "" });

    const diags = await checkAgents();
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message).toContain("Unexpected response");
  });
});

// ── checkUpdates ───────────────────────────────────────────

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

// ── checkCorruptTickets ────────────────────────────────────

describe("checkCorruptTickets", () => {
  const repos = [{ path: "/repo", name: "test-repo", addedAt: "2026-01-01" }];

  it("returns nothing when no beads", async () => {
    mockList.mockResolvedValue({ ok: true, data: [] });
    const diags = await checkCorruptTickets(repos);
    expect(diags).toHaveLength(0);
  });

  it("detects verification label with wrong status", async () => {
    mockList.mockResolvedValue({
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
    const diags = await checkCorruptTickets(repos);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].check).toBe("corrupt-bead-verification");
    expect(diags[0].fixable).toBe(true);
    expect(diags[0].fixOptions).toEqual([
      { key: "set-in-progress", label: "Set status to in_progress" },
      { key: "remove-label", label: "Remove stage:verification label" },
    ]);
    expect(diags[0].context?.beadId).toBe("b-1");
  });

  it("ignores verification bead already in_progress", async () => {
    mockList.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "b-2",
          title: "Good bead",
          status: "in_progress",
          labels: ["stage:verification"],
          type: "task",
          priority: 2,
          created: "2026-01-01",
          updated: "2026-01-01",
        },
      ],
    });
    const diags = await checkCorruptTickets(repos);
    expect(diags).toHaveLength(0);
  });
});

// ── checkStaleParents ──────────────────────────────────────

describe("checkStaleParents", () => {
  const repos = [{ path: "/repo", name: "test-repo", addedAt: "2026-01-01" }];

  it("detects parent with all children closed", async () => {
    mockList.mockResolvedValue({
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
        {
          id: "child-2",
          title: "Task 2",
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
    const diags = await checkStaleParents(repos);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].check).toBe("stale-parent");
    expect(diags[0].fixable).toBe(true);
    expect(diags[0].context?.beadId).toBe("parent-1");
  });

  it("ignores parent when some children are open", async () => {
    mockList.mockResolvedValue({
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
        {
          id: "child-2",
          title: "Task 2",
          status: "open",
          labels: [],
          type: "task",
          priority: 2,
          parent: "parent-1",
          created: "2026-01-01",
          updated: "2026-01-01",
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
          id: "parent-1",
          title: "Epic",
          status: "closed",
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
    const diags = await checkStaleParents(repos);
    expect(diags).toHaveLength(0);
  });
});

// ── checkPromptGuidance ───────────────────────────────────

describe("checkPromptGuidance", () => {
  it("warns when AGENTS.md exists but guidance marker is missing", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "foolery-doctor-guidance-"));
    try {
      await writeFile(join(repoPath, "AGENTS.md"), "# Agent Instructions\n");

      const diags = await checkPromptGuidance([
        { path: repoPath, name: "repo-a", addedAt: "2026-01-01" },
      ]);

      expect(diags).toHaveLength(1);
      expect(diags[0].check).toBe("prompt-guidance");
      expect(diags[0].severity).toBe("warning");
      expect(diags[0].fixable).toBe(true);
      expect(diags[0].fixOptions).toEqual([
        { key: "append", label: "Append Foolery guidance prompt" },
      ]);
      expect(diags[0].message).toContain("missing Foolery guidance prompt");
      expect(diags[0].context?.file).toBe("AGENTS.md");
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  it("does not warn when prompt marker is present", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "foolery-doctor-guidance-"));
    try {
      await writeFile(
        join(repoPath, "CLAUDE.md"),
        "<!-- FOOLERY_GUIDANCE_PROMPT_START -->\nFOOLERY_PROMPT_PROFILE: beads-coarse-human-gated\n## rules\n"
      );

      const diags = await checkPromptGuidance([
        { path: repoPath, name: "repo-b", addedAt: "2026-01-01" },
      ]);

      expect(diags).toHaveLength(0);
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });
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

describe("runDoctorFix", () => {
  const staleParentData = {
    ok: true,
    data: [
      {
        id: "parent-fix",
        title: "Parent",
        status: "open",
        labels: [],
        type: "epic",
        priority: 2,
        created: "2026-01-01",
        updated: "2026-01-01",
      },
      {
        id: "child-fix",
        title: "Child",
        status: "closed",
        labels: [],
        type: "task",
        priority: 2,
        parent: "parent-fix",
        created: "2026-01-01",
        updated: "2026-01-01",
      },
    ],
  };

  function setupStaleParent() {
    const repos = [{ path: "/repo", name: "test-repo", addedAt: "2026-01-01" }];
    mockListRepos.mockResolvedValue(repos);
    mockGetRegisteredAgents.mockResolvedValue({});
    mockList.mockResolvedValue(staleParentData);
    mockUpdate.mockResolvedValue({ ok: true });
  }

  it("fixes stale parent with default strategy", async () => {
    setupStaleParent();

    const fixReport = await runDoctorFix({ "stale-parent": "mark-verification" });
    expect(fixReport.fixes.length).toBeGreaterThanOrEqual(1);
    const verificationFix = fixReport.fixes.find((f) => f.check === "stale-parent");
    expect(verificationFix?.success).toBe(true);
    expect(verificationFix?.message).toContain("workflowState=verification");
    expect(mockUpdate).toHaveBeenCalledWith(
      "parent-fix",
      { status: "in_progress", workflowState: "verification" },
      "/repo",
    );
  });

  it("skips checks not included in strategies", async () => {
    setupStaleParent();

    const fixReport = await runDoctorFix({});
    expect(fixReport.fixes).toHaveLength(0);
    expect(fixReport.summary.attempted).toBe(0);
  });

  it("uses default first option when no strategies provided (backwards compat)", async () => {
    setupStaleParent();

    const fixReport = await runDoctorFix();
    expect(fixReport.fixes.length).toBeGreaterThanOrEqual(1);
    const verificationFix = fixReport.fixes.find((f) => f.check === "stale-parent");
    expect(verificationFix?.success).toBe(true);
  });
});

// ── streamDoctor ────────────────────────────────────────

describe("streamDoctor", () => {
  async function collectStream(): Promise<DoctorStreamEvent[]> {
    const events: DoctorStreamEvent[] = [];
    for await (const event of streamDoctor()) {
      events.push(event);
    }
    return events;
  }

  it("emits 8 check events plus 1 summary event", async () => {
    mockGetRegisteredAgents.mockResolvedValue({
      claude: { command: "claude", label: "Claude" },
    });
    mockExecFile.mockResolvedValue({ stdout: "1.2.3", stderr: "" });
    mockListRepos.mockResolvedValue([]);
    mockGetReleaseVersionStatus.mockResolvedValue({
      installedVersion: "1.0.0",
      latestVersion: "1.0.0",
      updateAvailable: false,
    });

    const events = await collectStream();
    expect(events).toHaveLength(9);

    // First 8 are check results
    for (let i = 0; i < 8; i++) {
      const ev = events[i] as DoctorCheckResult;
      expect(ev.done).toBeUndefined();
      expect(ev.category).toBeTruthy();
      expect(ev.label).toBeTruthy();
      expect(["pass", "fail", "warning"]).toContain(ev.status);
      expect(typeof ev.summary).toBe("string");
      expect(Array.isArray(ev.diagnostics)).toBe(true);
    }

    // Last is summary
    const summary = events[8] as DoctorStreamSummary;
    expect(summary.done).toBe(true);
    expect(typeof summary.passed).toBe("number");
    expect(typeof summary.failed).toBe("number");
    expect(typeof summary.warned).toBe("number");
    expect(typeof summary.fixable).toBe("number");
  });

  it("emits events in correct category order", async () => {
    mockGetRegisteredAgents.mockResolvedValue({});
    mockListRepos.mockResolvedValue([]);

    const events = await collectStream();
    const categories = events
      .filter((e): e is DoctorCheckResult => !("done" in e && e.done))
      .map((e) => e.category);

    expect(categories).toEqual([
      "agents",
      "updates",
      "settings-defaults",
      "repo-memory-managers",
      "memory-implementation",
      "workflow-pr-policy",
      "stale-parents",
      "prompt-guidance",
    ]);
  });

  it("reports fail status when agent check has errors", async () => {
    mockGetRegisteredAgents.mockResolvedValue({
      broken: { command: "broken-agent" },
    });
    mockExecFile.mockRejectedValue(new Error("command not found"));
    mockListRepos.mockResolvedValue([]);

    const events = await collectStream();
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

    const events = await collectStream();
    const updateEvent = events[1] as DoctorCheckResult;
    expect(updateEvent.category).toBe("updates");
    expect(updateEvent.status).toBe("warning");
  });

  it("counts fixable issues in summary", async () => {
    const repos = [{ path: "/repo", name: "test-repo", addedAt: "2026-01-01" }];
    mockListRepos.mockResolvedValue(repos);
    mockGetRegisteredAgents.mockResolvedValue({});
    mockList.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "parent-1",
          title: "Parent",
          status: "open",
          labels: [],
          type: "epic",
          priority: 2,
          created: "2026-01-01",
          updated: "2026-01-01",
        },
        {
          id: "child-1",
          title: "Child",
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

    const events = await collectStream();
    const summary = events[events.length - 1] as DoctorStreamSummary;
    expect(summary.done).toBe(true);
    expect(summary.fixable).toBe(1);
    expect(summary.warned).toBeGreaterThanOrEqual(1);
  });
});
