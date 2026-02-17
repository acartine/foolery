import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
vi.mock("@/lib/settings", () => ({
  getRegisteredAgents: () => mockGetRegisteredAgents(),
  scanForAgents: () => mockScanForAgents(),
  loadSettings: () => mockLoadSettings(),
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

import {
  checkAgents,
  checkUpdates,
  checkCorruptTickets,
  checkStaleParents,
  checkPromptGuidance,
  runDoctor,
  runDoctorFix,
} from "@/lib/doctor";

beforeEach(() => {
  vi.clearAllMocks();
  mockListRepos.mockResolvedValue([]);
  mockGetRegisteredAgents.mockResolvedValue({});
  mockGetReleaseVersionStatus.mockResolvedValue({
    installedVersion: "1.0.0",
    latestVersion: "1.0.0",
    updateAvailable: false,
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
    mockListBeads.mockResolvedValue({ ok: true, data: [] });
    const diags = await checkCorruptTickets(repos);
    expect(diags).toHaveLength(0);
  });

  it("detects verification label with wrong status", async () => {
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
    const diags = await checkCorruptTickets(repos);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].check).toBe("corrupt-ticket-verification");
    expect(diags[0].fixable).toBe(true);
    expect(diags[0].context?.beadId).toBe("b-1");
  });

  it("ignores verification bead already in_progress", async () => {
    mockListBeads.mockResolvedValue({
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
    mockListBeads.mockResolvedValue({
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
        "<!-- FOOLERY_GUIDANCE_PROMPT_START -->\n## rules\n"
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
  it("fixes corrupt verification ticket", async () => {
    const repos = [{ path: "/repo", name: "test-repo", addedAt: "2026-01-01" }];
    mockListRepos.mockResolvedValue(repos);
    mockGetRegisteredAgents.mockResolvedValue({});

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

    mockUpdateBead.mockResolvedValue({ ok: true });

    const fixReport = await runDoctorFix();
    expect(fixReport.fixes.length).toBeGreaterThanOrEqual(1);
    const verificationFix = fixReport.fixes.find((f) => f.check === "corrupt-ticket-verification");
    expect(verificationFix?.success).toBe(true);
  });
});
