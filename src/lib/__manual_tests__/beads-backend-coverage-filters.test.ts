/**
 * BeadsBackend coverage: update label operations,
 * matchExpression state/priority, applyFilters queued/in_action,
 * update profileId, and update with state change.
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

    const result3 = await backend.query(
      `workflowstate:${state}`,
    );
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

describe("BeadsBackend coverage: applyFilters queued state", () => {
    it("filters by state queued", async () => {
    const { backend } = createBackendWithRepo();

    await backend.create({
      title: "Queued beat",
      type: "task",
      priority: 2,
      labels: [],
    });

    const result = await backend.list({ state: "queued" });
    expect(result.ok).toBe(true);
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

    await backend.update(
      grandchild.data!.id, { state: "shipped" },
    );

    const result = await backend.list({ state: "queued" });
    expect(result.ok).toBe(true);

    const ids = result.data!.map((beat) => beat.id);
    expect(ids).toContain(parent.data!.id);
    expect(ids).toContain(child.data!.id);
    expect(ids).toContain(grandchild.data!.id);
  });

});

describe("BeadsBackend coverage: applyFilters in_action state", () => {
    it("filters by state in_action", async () => {
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

    const result = await backend.list({
      state: "in_action",
    });
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

    await backend.update(
      activeChild.data!.id, { state: "planning" },
    );

    const shippedChild = await backend.create({
      title: "Shipped child",
      type: "task",
      priority: 2,
      labels: [],
      parent: parent.data!.id,
    });
    expect(shippedChild.ok).toBe(true);

    await backend.update(
      shippedChild.data!.id, { state: "shipped" },
    );

    const result = await backend.list({
      state: "in_action",
    });
    expect(result.ok).toBe(true);

    const ids = result.data!.map((beat) => beat.id);
    expect(ids).toContain(activeChild.data!.id);
    expect(ids).toContain(parent.data!.id);
    expect(ids).toContain(grandparent.data!.id);
    expect(ids).not.toContain(shippedChild.data!.id);
  });

});

describe("BeadsBackend coverage: applyFilters exact and other", () => {
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

    const noResult = await backend.list({
      state: "nonexistent_state",
    });
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

    const noResult = await backend.list({
      workflowId: "nonexistent",
    });
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

});

describe("BeadsBackend coverage: applyFilters priority/assignee/label", () => {
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

    const noResult = await backend.list({
      label: "no-such-tag",
    });
    expect(noResult.ok).toBe(true);
    expect(noResult.data!.length).toBe(0);
  });
});
