/**
 * Lifecycle tests for BeadsBackend.
 *
 * Verifies that close_reason and dependencies persist across
 * cache resets (i.e. survive a flush-to-JSONL / reload cycle).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BeadsBackend } from "@/lib/backends/beads-backend";
import type { CreateBeadInput } from "@/lib/schemas";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function sample(title: string): CreateBeadInput {
  return { title, type: "task", priority: 2, labels: [] };
}

describe("BeadsBackend lifecycle", () => {
  let tempDir: string;
  let backend: BeadsBackend;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "beads-lifecycle-"));
    const beadsDir = join(tempDir, ".beads");
    mkdirSync(beadsDir, { recursive: true });
    writeFileSync(join(beadsDir, "issues.jsonl"), "", "utf-8");
    backend = new BeadsBackend(tempDir);
  });

  afterEach(() => {
    backend._reset();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("close reason persistence", () => {
    it("stores close_reason in metadata when reason is provided", async () => {
      const createRes = await backend.create(sample("test bead"));
      expect(createRes.ok).toBe(true);
      const id = (createRes as { ok: true; data: { id: string } }).data.id;

      const closeRes = await backend.close(id, "completed successfully");
      expect(closeRes.ok).toBe(true);

      const getRes = await backend.get(id);
      expect(getRes.ok).toBe(true);
      const bead = (getRes as { ok: true; data: { metadata?: Record<string, unknown> } }).data;
      expect(bead.metadata?.close_reason).toBe("completed successfully");
    });

    it("does not set metadata when close reason is omitted", async () => {
      const createRes = await backend.create(sample("no reason"));
      const id = (createRes as { ok: true; data: { id: string } }).data.id;

      await backend.close(id);

      const getRes = await backend.get(id);
      const bead = (getRes as { ok: true; data: { metadata?: Record<string, unknown> } }).data;
      expect(bead.metadata?.close_reason).toBeUndefined();
    });

    it("round-trips close_reason through JSONL after cache reset", async () => {
      const createRes = await backend.create(sample("round-trip bead"));
      const id = (createRes as { ok: true; data: { id: string } }).data.id;

      await backend.close(id, "migrated to other system");

      // Reset cache to force reload from disk
      backend._reset();

      const getRes = await backend.get(id);
      expect(getRes.ok).toBe(true);
      const bead = (getRes as { ok: true; data: { metadata?: Record<string, unknown> } }).data;
      expect(bead.metadata?.close_reason).toBe("migrated to other system");
    });
  });

  describe("dependency persistence", () => {
    it("persists dependencies across cache resets", async () => {
      const res1 = await backend.create(sample("blocker"));
      const res2 = await backend.create(sample("blocked"));
      const blockerId = (res1 as { ok: true; data: { id: string } }).data.id;
      const blockedId = (res2 as { ok: true; data: { id: string } }).data.id;

      const addRes = await backend.addDependency(blockerId, blockedId);
      expect(addRes.ok).toBe(true);

      // Reset cache to force reload from disk
      backend._reset();

      const depsRes = await backend.listDependencies(blockerId);
      expect(depsRes.ok).toBe(true);
      const deps = (depsRes as { ok: true; data: Array<{ source?: string; target?: string }> }).data;
      expect(deps).toHaveLength(1);
      expect(deps[0]!.source).toBe(blockerId);
      expect(deps[0]!.target).toBe(blockedId);
    });

    it("persists dependency removal across cache resets", async () => {
      const res1 = await backend.create(sample("blocker"));
      const res2 = await backend.create(sample("blocked"));
      const blockerId = (res1 as { ok: true; data: { id: string } }).data.id;
      const blockedId = (res2 as { ok: true; data: { id: string } }).data.id;

      await backend.addDependency(blockerId, blockedId);
      await backend.removeDependency(blockerId, blockedId);

      // Reset cache to force reload from disk
      backend._reset();

      const depsRes = await backend.listDependencies(blockerId);
      expect(depsRes.ok).toBe(true);
      const deps = (depsRes as { ok: true; data: unknown[] }).data;
      expect(deps).toHaveLength(0);
    });

    it("listReady excludes blocked beads after cache reset", async () => {
      const res1 = await backend.create(sample("blocker"));
      const res2 = await backend.create(sample("blocked"));
      const blockerId = (res1 as { ok: true; data: { id: string } }).data.id;
      const blockedId = (res2 as { ok: true; data: { id: string } }).data.id;

      await backend.addDependency(blockerId, blockedId);

      // Reset cache to force reload from disk
      backend._reset();

      const readyRes = await backend.listReady();
      expect(readyRes.ok).toBe(true);
      const ready = (readyRes as { ok: true; data: Array<{ id: string }> }).data;
      const readyIds = ready.map((b) => b.id);
      expect(readyIds).toContain(blockerId);
      expect(readyIds).not.toContain(blockedId);
    });
  });
});
