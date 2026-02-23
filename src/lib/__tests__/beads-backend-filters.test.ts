/**
 * Tests for BeadsBackend filter and query operations.
 *
 * Verifies that list() filters and query() expressions correctly handle
 * the label, owner, and parent fields.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BeadsBackend } from "@/lib/backends/beads-backend";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Test helpers ────────────────────────────────────────────────

function makeTempRepo(jsonlLines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "beads-filter-test-"));
  const beadsDir = join(dir, ".beads");
  mkdirSync(beadsDir, { recursive: true });
  writeFileSync(join(beadsDir, "issues.jsonl"), jsonlLines.join("\n"), "utf-8");
  return dir;
}

function jsonlRecord(overrides: Record<string, unknown>): string {
  const base = {
    id: "test-1",
    title: "Default bead",
    issue_type: "task",
    status: "open",
    priority: 2,
    labels: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  return JSON.stringify({ ...base, ...overrides });
}

// ── Tests ───────────────────────────────────────────────────────

describe("BeadsBackend filter operations", () => {
  let tempDir: string;
  let backend: BeadsBackend;

  afterEach(() => {
    backend._reset();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("list() with label filter", () => {
    beforeEach(() => {
      tempDir = makeTempRepo([
        jsonlRecord({ id: "b-1", title: "Has label", labels: ["urgent", "frontend"] }),
        jsonlRecord({ id: "b-2", title: "No match", labels: ["backend"] }),
        jsonlRecord({ id: "b-3", title: "Empty labels", labels: [] }),
      ]);
      backend = new BeadsBackend(tempDir);
    });

    it("returns only beads with the matching label", async () => {
      const result = await backend.list({ label: "urgent" });
      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].id).toBe("b-1");
    });

    it("returns empty when no bead has the label", async () => {
      const result = await backend.list({ label: "nonexistent" });
      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(0);
    });
  });

  describe("list() with owner filter", () => {
    beforeEach(() => {
      tempDir = makeTempRepo([
        jsonlRecord({ id: "b-1", title: "Owned by alice", owner: "alice" }),
        jsonlRecord({ id: "b-2", title: "Owned by bob", owner: "bob" }),
        jsonlRecord({ id: "b-3", title: "No owner" }),
      ]);
      backend = new BeadsBackend(tempDir);
    });

    it("returns only beads owned by the specified owner", async () => {
      const result = await backend.list({ owner: "alice" });
      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].id).toBe("b-1");
    });

    it("returns empty when no bead matches the owner", async () => {
      const result = await backend.list({ owner: "charlie" });
      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(0);
    });
  });

  describe("list() with parent filter", () => {
    beforeEach(() => {
      tempDir = makeTempRepo([
        jsonlRecord({ id: "epic-1", title: "Epic", parent: undefined }),
        jsonlRecord({ id: "b-1", title: "Child of epic", parent: "epic-1" }),
        jsonlRecord({ id: "b-2", title: "Another child", parent: "epic-1" }),
        jsonlRecord({ id: "b-3", title: "Different parent", parent: "epic-2" }),
      ]);
      backend = new BeadsBackend(tempDir);
    });

    it("returns only beads with the specified parent", async () => {
      const result = await backend.list({ parent: "epic-1" });
      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(2);
      const ids = result.data!.map((b) => b.id).sort();
      expect(ids).toEqual(["b-1", "b-2"]);
    });

    it("returns empty when no bead matches the parent", async () => {
      const result = await backend.list({ parent: "nonexistent" });
      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(0);
    });
  });
});

describe("BeadsBackend query expression operations", () => {
  let tempDir: string;
  let backend: BeadsBackend;

  afterEach(() => {
    backend._reset();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("query() with label expression", () => {
    beforeEach(() => {
      tempDir = makeTempRepo([
        jsonlRecord({ id: "b-1", title: "Has label", labels: ["urgent", "frontend"] }),
        jsonlRecord({ id: "b-2", title: "Other label", labels: ["backend"] }),
        jsonlRecord({ id: "b-3", title: "No labels", labels: [] }),
      ]);
      backend = new BeadsBackend(tempDir);
    });

    it("matches beads that have the queried label", async () => {
      const result = await backend.query("label:frontend");
      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].id).toBe("b-1");
    });

    it("returns empty when no bead has the label", async () => {
      const result = await backend.query("label:missing");
      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(0);
    });
  });

  describe("query() with owner expression", () => {
    beforeEach(() => {
      tempDir = makeTempRepo([
        jsonlRecord({ id: "b-1", title: "Alice bead", owner: "alice" }),
        jsonlRecord({ id: "b-2", title: "Bob bead", owner: "bob" }),
        jsonlRecord({ id: "b-3", title: "Unowned" }),
      ]);
      backend = new BeadsBackend(tempDir);
    });

    it("matches beads with the queried owner", async () => {
      const result = await backend.query("owner:bob");
      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].id).toBe("b-2");
    });

    it("returns empty when no bead matches the owner", async () => {
      const result = await backend.query("owner:unknown");
      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(0);
    });
  });

  describe("query() with parent expression", () => {
    beforeEach(() => {
      tempDir = makeTempRepo([
        jsonlRecord({ id: "b-1", title: "Child A", parent: "epic-1" }),
        jsonlRecord({ id: "b-2", title: "Child B", parent: "epic-1" }),
        jsonlRecord({ id: "b-3", title: "Other child", parent: "epic-2" }),
      ]);
      backend = new BeadsBackend(tempDir);
    });

    it("matches beads with the queried parent", async () => {
      const result = await backend.query("parent:epic-1");
      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(2);
      const ids = result.data!.map((b) => b.id).sort();
      expect(ids).toEqual(["b-1", "b-2"]);
    });

    it("returns empty when no bead matches the parent", async () => {
      const result = await backend.query("parent:nonexistent");
      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(0);
    });
  });

  describe("query() with combined expressions", () => {
    beforeEach(() => {
      tempDir = makeTempRepo([
        jsonlRecord({
          id: "b-1",
          title: "Match all",
          labels: ["urgent"],
          owner: "alice",
          parent: "epic-1",
        }),
        jsonlRecord({
          id: "b-2",
          title: "Wrong owner",
          labels: ["urgent"],
          owner: "bob",
          parent: "epic-1",
        }),
        jsonlRecord({
          id: "b-3",
          title: "Wrong label",
          labels: ["low"],
          owner: "alice",
          parent: "epic-1",
        }),
      ]);
      backend = new BeadsBackend(tempDir);
    });

    it("ANDs multiple field expressions together", async () => {
      const result = await backend.query("label:urgent owner:alice parent:epic-1");
      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].id).toBe("b-1");
    });
  });
});
