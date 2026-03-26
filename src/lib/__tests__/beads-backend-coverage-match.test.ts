/**
 * BeadsBackend coverage: matchExpression fields,
 * applyFilters edge cases, buildTakePrompt, and buildPollPrompt.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BeadsBackend } from "@/lib/backends/beads-backend";

// ── Setup ───────────────────────────────────────────────────

function makeTmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "beads-cov-"));
  mkdirSync(join(dir, ".beads"), { recursive: true });
  return dir;
}

let tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  tmpDirs = [];
});

function createBackendWithRepo(): {
  backend: BeadsBackend;
  repo: string;
} {
  const repo = makeTmpRepo();
  tmpDirs.push(repo);
  const backend = new BeadsBackend(repo);
  return { backend, repo };
}

// ── Tests ───────────────────────────────────────────────────

describe("BeadsBackend coverage: matchExpression owner/parent", () => {
    it("matches on nextowner/nextownerkind", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "Owner test",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);
    const id = created.data!.id;

    const beat = await backend.get(id);
    expect(beat.ok).toBe(true);
    const ownerKind = beat.data!.nextActionOwnerKind;

    const result = await backend.query(
      `nextownerkind:${ownerKind}`,
    );
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
    expect(result.data!.some((b) => b.id === id)).toBe(true);

    const result2 = await backend.query(
      `nextowner:${ownerKind}`,
    );
    expect(result2.ok).toBe(true);
    expect(result2.data!.some((b) => b.id === id)).toBe(true);
  });

  it("matches on owner field", async () => {
    const { backend } = createBackendWithRepo();

    await backend.create({
      title: "Owner beat",
      type: "task",
      priority: 2,
      labels: [],
    });

    const result = await backend.query("owner:nobody");
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(0);
  });

  it("matches on parent field", async () => {
    const { backend } = createBackendWithRepo();

    const parent = await backend.create({
      title: "Parent",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(parent.ok).toBe(true);

    const child = await backend.create({
      title: "Child",
      type: "task",
      priority: 2,
      labels: [],
      parent: parent.data!.id,
    });
    expect(child.ok).toBe(true);

    const result = await backend.query(
      `parent:${parent.data!.id}`,
    );
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);
    expect(result.data![0]!.id).toBe(child.data!.id);
  });

  it("ignores unknown expression fields (default case)", async () => {
    const { backend } = createBackendWithRepo();

    await backend.create({
      title: "Unknown field test",
      type: "task",
      priority: 2,
      labels: [],
    });

    const result = await backend.query("foo:bar");
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);
  });

});

describe("BeadsBackend coverage: matchExpression workflow/metadata", () => {
    it("matches on requireshumanaction / human field", async () => {
    const { backend } = createBackendWithRepo();

    await backend.create({
      title: "Human check",
      type: "task",
      priority: 2,
      labels: [],
    });

    const result = await backend.query(
      "requireshumanaction:false",
    );
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);

    const noResult = await backend.query("human:true");
    expect(noResult.ok).toBe(true);
    expect(noResult.data!.length).toBe(0);
  });

  it("matches on workflow/workflowid field", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "Workflow query",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);

    const beat = await backend.get(created.data!.id);
    const wfId = beat.data!.workflowId;

    const result = await backend.query(`workflowid:${wfId}`);
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);

    const result2 = await backend.query(`workflow:${wfId}`);
    expect(result2.ok).toBe(true);
    expect(result2.data!.length).toBe(1);
  });

  it("matches on profile/profileid field", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "Profile query",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);

    const beat = await backend.get(created.data!.id);
    const profileId = beat.data!.profileId;

    const result = await backend.query(
      `profileid:${profileId}`,
    );
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);

    const result2 = await backend.query(
      `profile:${profileId}`,
    );
    expect(result2.ok).toBe(true);
    expect(result2.data!.length).toBe(1);
  });

  it("matches on label field", async () => {
    const { backend } = createBackendWithRepo();

    await backend.create({
      title: "Labeled",
      type: "task",
      priority: 2,
      labels: ["my-label"],
    });

    const result = await backend.query("label:my-label");
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);
  });

  it("matches on assignee field", async () => {
    const { backend } = createBackendWithRepo();

    await backend.create({
      title: "Assigned",
      type: "task",
      priority: 2,
      labels: [],
      assignee: "alice",
    });

    const result = await backend.query("assignee:alice");
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);

    const noResult = await backend.query("assignee:bob");
    expect(noResult.ok).toBe(true);
    expect(noResult.data!.length).toBe(0);
  });
});

describe("BeadsBackend coverage: applyFilters edge cases", () => {
  it("filters by nextOwnerKind", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "Filter owner kind",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);

    const beat = await backend.get(created.data!.id);
    const ownerKind = beat.data!.nextActionOwnerKind;

    const result = await backend.list({
      nextOwnerKind: ownerKind,
    });
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);

    const noResult = await backend.list({
      nextOwnerKind: "nonexistent" as never,
    });
    expect(noResult.ok).toBe(true);
    expect(noResult.data!.length).toBe(0);
  });

  it("filters by requiresHumanAction", async () => {
    const { backend } = createBackendWithRepo();

    await backend.create({
      title: "Human filter",
      type: "task",
      priority: 2,
      labels: [],
    });

    const result = await backend.list({
      requiresHumanAction: false,
    });
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);

    const noResult = await backend.list({
      requiresHumanAction: true,
    });
    expect(noResult.ok).toBe(true);
    expect(noResult.data!.length).toBe(0);
  });

  it("filters by owner", async () => {
    const { backend } = createBackendWithRepo();

    await backend.create({
      title: "Owner filter",
      type: "task",
      priority: 2,
      labels: [],
    });

    const result = await backend.list({ owner: "someone" });
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(0);
  });

  it("filters by parent", async () => {
    const { backend } = createBackendWithRepo();

    const parent = await backend.create({
      title: "Parent",
      type: "task",
      priority: 2,
      labels: [],
    });
    const child = await backend.create({
      title: "Child",
      type: "task",
      priority: 2,
      labels: [],
      parent: parent.data!.id,
    });

    const result = await backend.list({
      parent: parent.data!.id,
    });
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);
    expect(result.data![0]!.id).toBe(child.data!.id);
  });
});

describe("BeadsBackend coverage: buildTakePrompt claimable", () => {
    it("claims queued agent-claimable beat and returns rich prompt", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "Take prompt test",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);

    const result = await backend.buildTakePrompt(
      created.data!.id,
    );
    expect(result.ok).toBe(true);
    expect(result.data?.claimed).toBe(true);
    expect(result.data?.prompt).toContain(created.data!.id);

    const beat = await backend.get(created.data!.id);
    expect(beat.ok).toBe(true);
    expect(beat.data!.state).not.toBe("ready_for_planning");
  });

  it("returns simple prompt for non-claimable beat (already active)", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "Active beat",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);

    await backend.update(
      created.data!.id, { state: "planning" },
    );

    const result = await backend.buildTakePrompt(
      created.data!.id,
    );
    expect(result.ok).toBe(true);
    expect(result.data?.prompt).toContain(
      `Beat ID: ${created.data!.id}`,
    );
    expect(result.data?.prompt).toContain("bd show");
    expect(result.data?.claimed).toBe(false);
  });

  it("returns simple prompt for non-claimable beat (already active) - variant", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "Active beat",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);

    await backend.update(
      created.data!.id, { state: "planning" },
    );

    const beat = await backend.get(created.data!.id);
    expect(beat.data!.isAgentClaimable).toBe(false);

    const result = await backend.buildTakePrompt(
      created.data!.id,
    );
    expect(result.ok).toBe(true);
    expect(result.data?.prompt).toContain(
      `Beat ID: ${created.data!.id}`,
    );
    expect(result.data?.prompt).toContain("bd show");
    expect(result.data?.claimed).toBe(false);
  });

  it("returns simple prompt for human-gated queued beat", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "Human queue",
      type: "task",
      priority: 2,
      labels: [],
      profileId: "semiauto",
    });
    expect(created.ok).toBe(true);

    await backend.update(created.data!.id, {
      state: "ready_for_plan_review",
    });

    const beat = await backend.get(created.data!.id);
    expect(beat.data!.isAgentClaimable).toBe(false);

    const result = await backend.buildTakePrompt(
      created.data!.id,
    );
    expect(result.ok).toBe(true);
    expect(result.data?.prompt).toContain(
      `Beat ID: ${created.data!.id}`,
    );
    expect(result.data?.claimed).toBe(false);
  });

});

describe("BeadsBackend coverage: buildTakePrompt parent/error", () => {
    it("returns parent prompt with child IDs", async () => {
    const { backend } = createBackendWithRepo();

    const parent = await backend.create({
      title: "Parent prompt",
      type: "task",
      priority: 2,
      labels: [],
    });
    const child = await backend.create({
      title: "Child",
      type: "task",
      priority: 2,
      labels: [],
    });

    const result = await backend.buildTakePrompt(
      parent.data!.id, {
        isParent: true,
        childBeatIds: [child.data!.id],
      },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.prompt).toContain("Parent beat ID:");
    expect(result.data?.prompt).toContain(child.data!.id);
    expect(result.data?.prompt).toContain(
      "Open child beat IDs:",
    );
    expect(result.data?.claimed).toBe(false);
  });

  it("returns NOT_FOUND for missing beat", async () => {
    const { backend } = createBackendWithRepo();

    const result = await backend.buildTakePrompt("missing-id");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

describe("BeadsBackend coverage: buildPollPrompt", () => {
  it("claims the highest-priority claimable beat", async () => {
    const { backend } = createBackendWithRepo();

    const low = await backend.create({
      title: "Low priority",
      type: "task",
      priority: 3,
      labels: [],
    });
    const high = await backend.create({
      title: "High priority",
      type: "task",
      priority: 1,
      labels: [],
    });
    expect(low.ok).toBe(true);
    expect(high.ok).toBe(true);

    const result = await backend.buildPollPrompt();
    expect(result.ok).toBe(true);
    expect(result.data?.claimedId).toBe(high.data!.id);
    expect(result.data?.prompt).toBeTruthy();

    const beat = await backend.get(high.data!.id);
    expect(beat.ok).toBe(true);
    expect(beat.data!.state).not.toBe("ready_for_planning");
  });

  it("returns NOT_FOUND when no claimable beats exist", async () => {
    const { backend } = createBackendWithRepo();

    const result = await backend.buildPollPrompt();
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
    expect(result.error?.message).toContain(
      "No claimable beats available",
    );
  });

  it("skips non-agent-claimable beats (active state)", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "Active beat",
      type: "task",
      priority: 1,
      labels: [],
    });
    expect(created.ok).toBe(true);

    await backend.update(
      created.data!.id, { state: "planning" },
    );

    const result = await backend.buildPollPrompt();
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});
