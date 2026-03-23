/**
 * Additional coverage tests for BeadsBackend.
 *
 * Targets uncovered lines in beads-backend.ts, focusing on:
 *  - matchExpression: nextowner/nextownerkind, owner, parent, default
 *  - applyFilters: requiresHumanAction, nextOwnerKind, owner, parent
 *  - buildTakePrompt and buildPollPrompt
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
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

function createBackendWithRepo(): { backend: BeadsBackend; repo: string } {
  const repo = makeTmpRepo();
  tmpDirs.push(repo);
  const backend = new BeadsBackend(repo);
  return { backend, repo };
}

// ── Tests ───────────────────────────────────────────────────

describe("BeadsBackend coverage: matchExpression fields", () => {
  it("matches on nextowner/nextownerkind", async () => {
    const { backend } = createBackendWithRepo();

    // Create a beat and check its nextActionOwnerKind
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

    const result = await backend.query(`nextownerkind:${ownerKind}`);
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
    expect(result.data!.some((b) => b.id === id)).toBe(true);

    // Also check "nextowner" alias
    const result2 = await backend.query(`nextowner:${ownerKind}`);
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

    // query for a specific owner that does not exist
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

    const result = await backend.query(`parent:${parent.data!.id}`);
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
    // Unknown fields should return true (pass through)
    expect(result.data!.length).toBe(1);
  });

  it("matches on requireshumanaction / human field", async () => {
    const { backend } = createBackendWithRepo();

    await backend.create({
      title: "Human check",
      type: "task",
      priority: 2,
      labels: [],
    });

    const result = await backend.query("requireshumanaction:false");
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);

    const noResult = await backend.query("human:true");
    expect(noResult.ok).toBe(true);
    // Default profile beats should not require human action
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

    const result = await backend.query(`profileid:${profileId}`);
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);

    const result2 = await backend.query(`profile:${profileId}`);
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

    const result = await backend.list({ nextOwnerKind: ownerKind });
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

    const result = await backend.list({ requiresHumanAction: false });
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);

    const noResult = await backend.list({ requiresHumanAction: true });
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
    // Beats do not have an owner set by default
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

    const result = await backend.list({ parent: parent.data!.id });
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);
    expect(result.data![0]!.id).toBe(child.data!.id);
  });
});

describe("BeadsBackend coverage: buildTakePrompt", () => {
  it("claims queued agent-claimable beat and returns rich prompt", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "Take prompt test",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);

    const result = await backend.buildTakePrompt(created.data!.id);
    expect(result.ok).toBe(true);
    expect(result.data?.claimed).toBe(true);
    // Rich prompt should contain the beat ID and step-specific content
    expect(result.data?.prompt).toContain(created.data!.id);

    // Beat should now be in an active state
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

    // Move to active state first
    await backend.update(created.data!.id, { state: "planning" });

    const result = await backend.buildTakePrompt(created.data!.id);
    expect(result.ok).toBe(true);
    expect(result.data?.prompt).toContain(`Beat ID: ${created.data!.id}`);
    expect(result.data?.prompt).toContain("bd show");
    expect(result.data?.claimed).toBe(false);
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

    // Move to an active state (not queued phase, so not claimable)
    await backend.update(created.data!.id, { state: "planning" });

    const beat = await backend.get(created.data!.id);
    expect(beat.data!.isAgentClaimable).toBe(false);

    const result = await backend.buildTakePrompt(created.data!.id);
    expect(result.ok).toBe(true);
    expect(result.data?.prompt).toContain(`Beat ID: ${created.data!.id}`);
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

    // Move to ready_for_plan_review which is human-owned in semiauto
    await backend.update(created.data!.id, { state: "ready_for_plan_review" });

    const beat = await backend.get(created.data!.id);
    expect(beat.data!.isAgentClaimable).toBe(false);

    const result = await backend.buildTakePrompt(created.data!.id);
    expect(result.ok).toBe(true);
    expect(result.data?.prompt).toContain(`Beat ID: ${created.data!.id}`);
    expect(result.data?.claimed).toBe(false);
  });

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

    const result = await backend.buildTakePrompt(parent.data!.id, {
      isParent: true,
      childBeatIds: [child.data!.id],
    });

    expect(result.ok).toBe(true);
    expect(result.data?.prompt).toContain("Parent beat ID:");
    expect(result.data?.prompt).toContain(child.data!.id);
    expect(result.data?.prompt).toContain("Open child beat IDs:");
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

    // Create beats with different priorities
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
    // Should claim the highest-priority (lowest number) beat
    expect(result.data?.claimedId).toBe(high.data!.id);
    expect(result.data?.prompt).toBeTruthy();

    // Verify the beat was transitioned to active state
    const beat = await backend.get(high.data!.id);
    expect(beat.ok).toBe(true);
    expect(beat.data!.state).not.toBe("ready_for_planning");
  });

  it("returns NOT_FOUND when no claimable beats exist", async () => {
    const { backend } = createBackendWithRepo();

    const result = await backend.buildPollPrompt();
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
    expect(result.error?.message).toContain("No claimable beats available");
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

    // Move to an active state so it is not in listReady
    await backend.update(created.data!.id, { state: "planning" });

    const result = await backend.buildPollPrompt();
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

describe("BeadsBackend coverage: update label operations", () => {
  it("adds labels via update", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "Label add",
      type: "task",
      priority: 2,
      labels: ["existing"],
    });
    expect(created.ok).toBe(true);

    const result = await backend.update(created.data!.id, {
      labels: ["new-label"],
    });
    expect(result.ok).toBe(true);

    const beat = await backend.get(created.data!.id);
    expect(beat.ok).toBe(true);
    expect(beat.data!.labels).toContain("new-label");
  });

  it("removes labels via update", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "Label remove",
      type: "task",
      priority: 2,
      labels: ["keep-me", "remove-me"],
    });
    expect(created.ok).toBe(true);

    const result = await backend.update(created.data!.id, {
      removeLabels: ["remove-me"],
    });
    expect(result.ok).toBe(true);

    const beat = await backend.get(created.data!.id);
    expect(beat.ok).toBe(true);
    expect(beat.data!.labels).not.toContain("remove-me");
  });
});

describe("BeadsBackend coverage: matchExpression state and priority", () => {
  it("matches on state/status/workflowstate", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "State match",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);

    const beat = await backend.get(created.data!.id);
    const state = beat.data!.state;

    const result1 = await backend.query(`state:${state}`);
    expect(result1.ok).toBe(true);
    expect(result1.data!.length).toBe(1);

    const result2 = await backend.query(`status:${state}`);
    expect(result2.ok).toBe(true);
    expect(result2.data!.length).toBe(1);

    const result3 = await backend.query(`workflowstate:${state}`);
    expect(result3.ok).toBe(true);
    expect(result3.data!.length).toBe(1);
  });

  it("matches on priority as string", async () => {
    const { backend } = createBackendWithRepo();

    await backend.create({
      title: "Priority match",
      type: "task",
      priority: 1,
      labels: [],
    });

    const result = await backend.query("priority:1");
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);

    const noResult = await backend.query("priority:3");
    expect(noResult.ok).toBe(true);
    expect(noResult.data!.length).toBe(0);
  });

  it("matches on type", async () => {
    const { backend } = createBackendWithRepo();

    await backend.create({
      title: "Type match",
      type: "bug",
      priority: 2,
      labels: [],
    });

    const result = await backend.query("type:bug");
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);
  });
});

describe("BeadsBackend coverage: applyFilters queued/in_action/exact", () => {
  it("filters by state queued", async () => {
    const { backend } = createBackendWithRepo();

    await backend.create({
      title: "Queued beat",
      type: "task",
      priority: 2,
      labels: [],
    });

    // Default state should be a queued state
    const result = await backend.list({ state: "queued" });
    expect(result.ok).toBe(true);
    // At least our created beat should show up
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps terminal descendants when a parent is queued", async () => {
    const { backend } = createBackendWithRepo();

    const parent = await backend.create({
      title: "Queued parent",
      type: "epic",
      priority: 2,
      labels: [],
    });
    expect(parent.ok).toBe(true);

    const child = await backend.create({
      title: "Queued child",
      type: "task",
      priority: 2,
      labels: [],
      parent: parent.data!.id,
    });
    expect(child.ok).toBe(true);

    const grandchild = await backend.create({
      title: "Shipped grandchild",
      type: "task",
      priority: 2,
      labels: [],
      parent: child.data!.id,
    });
    expect(grandchild.ok).toBe(true);

    await backend.update(grandchild.data!.id, { state: "shipped" });

    const result = await backend.list({ state: "queued" });
    expect(result.ok).toBe(true);

    const ids = result.data!.map((beat) => beat.id);
    expect(ids).toContain(parent.data!.id);
    expect(ids).toContain(child.data!.id);
    expect(ids).toContain(grandchild.data!.id);
  });

  it("filters by state in_action", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "Active beat",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);

    // Move to an active state
    await backend.update(created.data!.id, { state: "planning" });

    const result = await backend.list({ state: "in_action" });
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
  });

  it("includes each active beat's queued ancestors without surfacing terminal siblings", async () => {
    const { backend } = createBackendWithRepo();

    const grandparent = await backend.create({
      title: "Queued grandparent",
      type: "initiative",
      priority: 2,
      labels: [],
    });
    expect(grandparent.ok).toBe(true);

    const parent = await backend.create({
      title: "Queued parent",
      type: "epic",
      priority: 2,
      labels: [],
      parent: grandparent.data!.id,
    });
    expect(parent.ok).toBe(true);

    const activeChild = await backend.create({
      title: "Active child",
      type: "task",
      priority: 2,
      labels: [],
      parent: parent.data!.id,
    });
    expect(activeChild.ok).toBe(true);

    // Move to an active state
    await backend.update(activeChild.data!.id, { state: "planning" });

    const shippedChild = await backend.create({
      title: "Shipped child",
      type: "task",
      priority: 2,
      labels: [],
      parent: parent.data!.id,
    });
    expect(shippedChild.ok).toBe(true);

    await backend.update(shippedChild.data!.id, { state: "shipped" });

    const result = await backend.list({ state: "in_action" });
    expect(result.ok).toBe(true);

    const ids = result.data!.map((beat) => beat.id);
    // Active child still appears directly.
    expect(ids).toContain(activeChild.data!.id);
    // Parent chain must remain visible in Active.
    expect(ids).toContain(parent.data!.id);
    expect(ids).toContain(grandparent.data!.id);
    // Shipped child must NOT appear in Active view.
    expect(ids).not.toContain(shippedChild.data!.id);
  });

  it("filters by exact state name", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "Exact state",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);

    const beat = await backend.get(created.data!.id);
    const exactState = beat.data!.state;

    const result = await backend.list({ state: exactState });
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);

    // Non-matching exact state
    const noResult = await backend.list({ state: "nonexistent_state" });
    expect(noResult.ok).toBe(true);
    expect(noResult.data!.length).toBe(0);
  });

  it("filters by workflowId", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "Workflow filter",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);

    const beat = await backend.get(created.data!.id);
    const wfId = beat.data!.workflowId;

    const result = await backend.list({ workflowId: wfId });
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);

    const noResult = await backend.list({ workflowId: "nonexistent" });
    expect(noResult.ok).toBe(true);
    expect(noResult.data!.length).toBe(0);
  });

  it("filters by profileId", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "Profile filter",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);

    const beat = await backend.get(created.data!.id);
    const profileId = beat.data!.profileId;

    const result = await backend.list({ profileId });
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);
  });

  it("filters by priority (non-matching)", async () => {
    const { backend } = createBackendWithRepo();

    await backend.create({
      title: "Priority 2",
      type: "task",
      priority: 2,
      labels: [],
    });

    const noResult = await backend.list({ priority: 4 });
    expect(noResult.ok).toBe(true);
    expect(noResult.data!.length).toBe(0);
  });

  it("filters by assignee", async () => {
    const { backend } = createBackendWithRepo();

    await backend.create({
      title: "Assigned",
      type: "task",
      priority: 2,
      labels: [],
      assignee: "alice",
    });

    const result = await backend.list({ assignee: "alice" });
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);

    const noResult = await backend.list({ assignee: "bob" });
    expect(noResult.ok).toBe(true);
    expect(noResult.data!.length).toBe(0);
  });

  it("filters by label", async () => {
    const { backend } = createBackendWithRepo();

    await backend.create({
      title: "Labeled",
      type: "task",
      priority: 2,
      labels: ["my-tag"],
    });

    const result = await backend.list({ label: "my-tag" });
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);

    const noResult = await backend.list({ label: "no-such-tag" });
    expect(noResult.ok).toBe(true);
    expect(noResult.data!.length).toBe(0);
  });

  it("includes ancestor chain when a queued child's parent is not in a queued state", async () => {
    const { backend } = createBackendWithRepo();

    const parent = await backend.create({
      title: "Active parent",
      type: "epic",
      priority: 2,
      labels: [],
    });
    expect(parent.ok).toBe(true);
    // Move parent to an active (non-queued) state
    await backend.update(parent.data!.id, { state: "implementation" });

    const child = await backend.create({
      title: "Queued child",
      type: "task",
      priority: 2,
      labels: [],
      parent: parent.data!.id,
    });
    expect(child.ok).toBe(true);
    // Child stays in default queued state (ready_for_planning)

    const result = await backend.list({ state: "queued" });
    expect(result.ok).toBe(true);

    const ids = result.data!.map((b) => b.id);
    // The queued child should appear
    expect(ids).toContain(child.data!.id);
    // The non-queued parent must also appear as an ancestor
    expect(ids).toContain(parent.data!.id);
  });

  it("includes full ancestor chain for deeply nested queued descendants", async () => {
    const { backend } = createBackendWithRepo();

    const grandparent = await backend.create({
      title: "Shipped grandparent",
      type: "initiative",
      priority: 2,
      labels: [],
    });
    expect(grandparent.ok).toBe(true);
    await backend.update(grandparent.data!.id, { state: "shipped" });

    const parent = await backend.create({
      title: "Active parent",
      type: "epic",
      priority: 2,
      labels: [],
      parent: grandparent.data!.id,
    });
    expect(parent.ok).toBe(true);
    await backend.update(parent.data!.id, { state: "implementation" });

    const child = await backend.create({
      title: "Queued child",
      type: "task",
      priority: 2,
      labels: [],
      parent: parent.data!.id,
    });
    expect(child.ok).toBe(true);

    const result = await backend.list({ state: "queued" });
    expect(result.ok).toBe(true);

    const ids = result.data!.map((b) => b.id);
    expect(ids).toContain(child.data!.id);
    expect(ids).toContain(parent.data!.id);
    expect(ids).toContain(grandparent.data!.id);
  });

  it("exact state filter does not pull in ancestors", async () => {
    const { backend } = createBackendWithRepo();

    const parent = await backend.create({
      title: "Shipped parent",
      type: "epic",
      priority: 2,
      labels: [],
    });
    expect(parent.ok).toBe(true);
    await backend.update(parent.data!.id, { state: "shipped" });

    const child = await backend.create({
      title: "Ready child",
      type: "task",
      priority: 2,
      labels: [],
      parent: parent.data!.id,
    });
    expect(child.ok).toBe(true);

    const result = await backend.list({ state: "ready_for_planning" });
    expect(result.ok).toBe(true);

    const ids = result.data!.map((b) => b.id);
    expect(ids).toContain(child.data!.id);
    expect(ids).not.toContain(parent.data!.id);
  });
});

describe("BeadsBackend coverage: update profileId without state", () => {
  it("re-normalizes state when profileId changes without explicit state", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "Profile change",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);

    // Update profileId to a different supported profile
    // "beads-coarse-human-gated" normalizes to "semiauto" internally
    const result = await backend.update(created.data!.id, {
      profileId: "beads-coarse-human-gated",
    });
    expect(result.ok).toBe(true);

    const beat = await backend.get(created.data!.id);
    expect(beat.ok).toBe(true);
    expect(beat.data!.profileId).toBe("semiauto");
  });
});

describe("BeadsBackend coverage: update with state change", () => {
  it("updates state and recalculates workflow runtime", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "State update",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);

    // Get initial state
    const before = await backend.get(created.data!.id);
    expect(before.ok).toBe(true);

    // Update to a different state
    const result = await backend.update(created.data!.id, {
      state: "shipped",
    });
    expect(result.ok).toBe(true);

    const after = await backend.get(created.data!.id);
    expect(after.ok).toBe(true);
    expect(after.data!.state).toBe("shipped");
  });

  it("returns NOT_FOUND when updating nonexistent beat", async () => {
    const { backend } = createBackendWithRepo();

    const result = await backend.update("nonexistent", { title: "nope" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("returns INVALID_INPUT for unsupported profile", async () => {
    const { backend } = createBackendWithRepo();

    const created = await backend.create({
      title: "Profile update",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);

    const result = await backend.update(created.data!.id, {
      profileId: "nonexistent-profile",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_INPUT");
  });
});

describe("BeadsBackend coverage: invariant emulation in notes", () => {
  it("persists create invariants into notes while keeping visible notes clean", async () => {
    const { backend, repo } = createBackendWithRepo();

    const created = await backend.create({
      title: "Invariant create",
      type: "task",
      priority: 2,
      labels: [],
      notes: "Operator note",
      invariants: [{ kind: "Scope", condition: "src/lib" }],
    });
    expect(created.ok).toBe(true);

    const fetched = await backend.get(created.data!.id);
    expect(fetched.ok).toBe(true);
    expect(fetched.data!.notes).toBe("Operator note");
    expect(fetched.data!.invariants).toEqual([{ kind: "Scope", condition: "src/lib" }]);

    const rawLines = readFileSync(join(repo, ".beads", "issues.jsonl"), "utf-8")
      .split("\n")
      .filter(Boolean);
    const raw = JSON.parse(rawLines[0]!) as { notes?: string };
    expect(raw.notes).toContain("[Invariants]");
    expect(raw.notes).toContain("Scope: src/lib");
  });

  it("supports add/remove/clear invariant updates", async () => {
    const { backend, repo } = createBackendWithRepo();

    const created = await backend.create({
      title: "Invariant updates",
      type: "task",
      priority: 2,
      labels: [],
      notes: "Persistent note",
    });
    expect(created.ok).toBe(true);

    const addResult = await backend.update(created.data!.id, {
      addInvariants: [
        { kind: "Scope", condition: "src/lib" },
        { kind: "State", condition: "must stay queued" },
      ],
    });
    expect(addResult.ok).toBe(true);

    const afterAdd = await backend.get(created.data!.id);
    expect(afterAdd.ok).toBe(true);
    expect(afterAdd.data!.invariants).toEqual([
      { kind: "Scope", condition: "src/lib" },
      { kind: "State", condition: "must stay queued" },
    ]);

    const removeResult = await backend.update(created.data!.id, {
      removeInvariants: [{ kind: "Scope", condition: "src/lib" }],
    });
    expect(removeResult.ok).toBe(true);

    const afterRemove = await backend.get(created.data!.id);
    expect(afterRemove.ok).toBe(true);
    expect(afterRemove.data!.invariants).toEqual([
      { kind: "State", condition: "must stay queued" },
    ]);

    const clearResult = await backend.update(created.data!.id, {
      clearInvariants: true,
    });
    expect(clearResult.ok).toBe(true);

    const afterClear = await backend.get(created.data!.id);
    expect(afterClear.ok).toBe(true);
    expect(afterClear.data!.invariants).toBeUndefined();
    expect(afterClear.data!.notes).toBe("Persistent note");

    const rawLines = readFileSync(join(repo, ".beads", "issues.jsonl"), "utf-8")
      .split("\n")
      .filter(Boolean);
    const raw = JSON.parse(rawLines[0]!) as { notes?: string };
    expect(raw.notes).toBe("Persistent note");
  });

  it("normalizes invariant conditions and deduplicates before persisting notes", async () => {
    const { backend, repo } = createBackendWithRepo();

    const created = await backend.create({
      title: "Invariant normalize",
      type: "task",
      priority: 2,
      labels: [],
      notes: "Operator note",
      invariants: [
        { kind: "Scope", condition: " src/lib " },
        { kind: "Scope", condition: "src/lib" },
        { kind: "State", condition: "   " },
      ],
    });
    expect(created.ok).toBe(true);

    const fetched = await backend.get(created.data!.id);
    expect(fetched.ok).toBe(true);
    expect(fetched.data!.invariants).toEqual([{ kind: "Scope", condition: "src/lib" }]);

    const addResult = await backend.update(created.data!.id, {
      addInvariants: [
        { kind: "Scope", condition: " src/lib " },
        { kind: "State", condition: " must stay queued " },
      ],
    });
    expect(addResult.ok).toBe(true);

    const afterAdd = await backend.get(created.data!.id);
    expect(afterAdd.ok).toBe(true);
    expect(afterAdd.data!.invariants).toEqual([
      { kind: "Scope", condition: "src/lib" },
      { kind: "State", condition: "must stay queued" },
    ]);

    const rawLines = readFileSync(join(repo, ".beads", "issues.jsonl"), "utf-8")
      .split("\n")
      .filter(Boolean);
    const raw = JSON.parse(rawLines[0]!) as { notes?: string };
    expect(raw.notes).toBe(
      "Operator note\n\n[Invariants]\nScope: src/lib\nState: must stay queued",
    );
  });
});
