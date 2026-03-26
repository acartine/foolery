/**
 * BeadsBackend coverage: ancestor chains for queued/in_action,
 * update profileId, update state, and invariant emulation.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync, mkdirSync, readFileSync, rmSync,
} from "node:fs";
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

describe("BeadsBackend coverage: ancestor chain inclusion", () => {
  it("includes ancestor chain when a queued child's parent is not in a queued state", async () => {
    const { backend } = createBackendWithRepo();

    const parent = await backend.create({
      title: "Active parent",
      type: "epic",
      priority: 2,
      labels: [],
    });
    expect(parent.ok).toBe(true);
    await backend.update(
      parent.data!.id, { state: "implementation" },
    );

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
    await backend.update(
      grandparent.data!.id, { state: "shipped" },
    );

    const parent = await backend.create({
      title: "Active parent",
      type: "epic",
      priority: 2,
      labels: [],
      parent: grandparent.data!.id,
    });
    expect(parent.ok).toBe(true);
    await backend.update(
      parent.data!.id, { state: "implementation" },
    );

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
    await backend.update(
      parent.data!.id, { state: "shipped" },
    );

    const child = await backend.create({
      title: "Ready child",
      type: "task",
      priority: 2,
      labels: [],
      parent: parent.data!.id,
    });
    expect(child.ok).toBe(true);

    const result = await backend.list({
      state: "ready_for_planning",
    });
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

    const result = await backend.update(
      "nonexistent", { title: "nope" },
    );
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
      invariants: [
        { kind: "Scope", condition: "src/lib" },
      ],
    });
    expect(created.ok).toBe(true);

    const fetched = await backend.get(created.data!.id);
    expect(fetched.ok).toBe(true);
    expect(fetched.data!.notes).toBe("Operator note");
    expect(fetched.data!.invariants).toEqual([
      { kind: "Scope", condition: "src/lib" },
    ]);

    const rawLines = readFileSync(
      join(repo, ".beads", "issues.jsonl"), "utf-8",
    )
      .split("\n")
      .filter(Boolean);
    const raw = JSON.parse(rawLines[0]!) as {
      notes?: string;
    };
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

    const addResult = await backend.update(
      created.data!.id, {
        addInvariants: [
          { kind: "Scope", condition: "src/lib" },
          { kind: "State", condition: "must stay queued" },
        ],
      },
    );
    expect(addResult.ok).toBe(true);

    const afterAdd = await backend.get(created.data!.id);
    expect(afterAdd.ok).toBe(true);
    expect(afterAdd.data!.invariants).toEqual([
      { kind: "Scope", condition: "src/lib" },
      { kind: "State", condition: "must stay queued" },
    ]);

    const removeResult = await backend.update(
      created.data!.id, {
        removeInvariants: [
          { kind: "Scope", condition: "src/lib" },
        ],
      },
    );
    expect(removeResult.ok).toBe(true);

    const afterRemove = await backend.get(created.data!.id);
    expect(afterRemove.ok).toBe(true);
    expect(afterRemove.data!.invariants).toEqual([
      { kind: "State", condition: "must stay queued" },
    ]);

    const clearResult = await backend.update(
      created.data!.id, { clearInvariants: true },
    );
    expect(clearResult.ok).toBe(true);

    const afterClear = await backend.get(created.data!.id);
    expect(afterClear.ok).toBe(true);
    expect(afterClear.data!.invariants).toBeUndefined();
    expect(afterClear.data!.notes).toBe("Persistent note");

    const rawLines = readFileSync(
      join(repo, ".beads", "issues.jsonl"), "utf-8",
    )
      .split("\n")
      .filter(Boolean);
    const raw = JSON.parse(rawLines[0]!) as {
      notes?: string;
    };
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
    expect(fetched.data!.invariants).toEqual([
      { kind: "Scope", condition: "src/lib" },
    ]);

    const addResult = await backend.update(
      created.data!.id, {
        addInvariants: [
          { kind: "Scope", condition: " src/lib " },
          { kind: "State", condition: " must stay queued " },
        ],
      },
    );
    expect(addResult.ok).toBe(true);

    const afterAdd = await backend.get(created.data!.id);
    expect(afterAdd.ok).toBe(true);
    expect(afterAdd.data!.invariants).toEqual([
      { kind: "Scope", condition: "src/lib" },
      { kind: "State", condition: "must stay queued" },
    ]);

    const rawLines = readFileSync(
      join(repo, ".beads", "issues.jsonl"), "utf-8",
    )
      .split("\n")
      .filter(Boolean);
    const raw = JSON.parse(rawLines[0]!) as {
      notes?: string;
    };
    expect(raw.notes).toBe(
      "Operator note\n\n[Invariants]\n"
      + "Scope: src/lib\nState: must stay queued",
    );
  });
});
