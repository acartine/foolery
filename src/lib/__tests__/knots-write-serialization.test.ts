import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We need to mock child_process.execFile to control when commands resolve
const execFileCallbacks: Array<{
  args: string[];
  callback: (error: Error | null, stdout: string, stderr: string) => void;
}> = [];

vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (
      _bin: string,
      args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      execFileCallbacks.push({ args, callback });
    },
  ),
}));

// Import AFTER mocking
import { _pendingWriteCount, newKnot, updateKnot, listKnots, showKnot } from "../knots";

describe("knots write serialization", () => {
  beforeEach(() => {
    execFileCallbacks.length = 0;
  });

  afterEach(() => {
    // Resolve any lingering callbacks to avoid dangling promises
    for (const entry of execFileCallbacks) {
      entry.callback(null, "{}", "");
    }
    execFileCallbacks.length = 0;
  });

  it("serializes concurrent write operations", async () => {
    const repo = "/tmp/test-repo-serialize";

    // Fire two concurrent writes
    const write1 = newKnot("first", {}, repo);
    const write2 = updateKnot("K-0001", { title: "updated" }, repo);

    // Wait for microtask queue to flush so the first write's exec is called
    await vi.waitFor(() => {
      expect(execFileCallbacks.length).toBe(1);
    });

    // Only one write should be in-flight; second is queued
    expect(_pendingWriteCount(repo)).toBe(2);
    expect(execFileCallbacks).toHaveLength(1);

    // Complete the first write (newKnot output: "created K-0001")
    execFileCallbacks[0].callback(null, "created K-0001", "");

    // Now the second write should start
    await vi.waitFor(() => {
      expect(execFileCallbacks.length).toBe(2);
    });

    // Complete the second write
    execFileCallbacks[1].callback(null, "", "");

    const [r1, r2] = await Promise.all([write1, write2]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(_pendingWriteCount(repo)).toBe(0);
  });

  it("does not serialize read operations", async () => {
    const repo = "/tmp/test-repo-reads";

    // Fire two concurrent reads
    const read1 = listKnots(repo);
    const read2 = showKnot("K-0001", repo);

    // Both reads should be in flight concurrently
    await vi.waitFor(() => {
      expect(execFileCallbacks.length).toBe(2);
    });

    // Resolve both
    execFileCallbacks[0].callback(null, "[]", "");
    execFileCallbacks[1].callback(
      null,
      '{"id":"K-0001","title":"test","state":"planning","updated_at":"2025-01-01"}',
      "",
    );

    const [r1, r2] = await Promise.all([read1, read2]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it("reads proceed while a write is in-flight", async () => {
    const repo = "/tmp/test-repo-mixed";

    // Start a write
    const write1 = newKnot("first", {}, repo);

    await vi.waitFor(() => {
      expect(execFileCallbacks.length).toBe(1);
    });

    // Start a read while the write is queued but not complete
    const read1 = showKnot("K-0001", repo);

    // The read should be in-flight immediately alongside the write
    await vi.waitFor(() => {
      expect(execFileCallbacks.length).toBe(2);
    });

    // Resolve both
    execFileCallbacks[0].callback(null, "created K-0001", "");
    execFileCallbacks[1].callback(
      null,
      '{"id":"K-0001","title":"test","state":"planning","updated_at":"2025-01-01"}',
      "",
    );

    const [r1, r2] = await Promise.all([write1, read1]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it("cleans up queue state when all writes complete", async () => {
    const repo = "/tmp/test-repo-cleanup";

    const write1 = newKnot("task", {}, repo);

    await vi.waitFor(() => {
      expect(execFileCallbacks.length).toBe(1);
    });

    expect(_pendingWriteCount(repo)).toBe(1);
    execFileCallbacks[0].callback(null, "created K-0001", "");

    await write1;
    expect(_pendingWriteCount(repo)).toBe(0);
  });

  it("continues processing queue after a write error", async () => {
    const repo = "/tmp/test-repo-error";

    // Fire two writes, first will fail
    const write1 = newKnot("first", {}, repo);
    const write2 = newKnot("second", {}, repo);

    await vi.waitFor(() => {
      expect(execFileCallbacks.length).toBe(1);
    });

    // Fail the first write
    const err = new Error("lock contention") as NodeJS.ErrnoException;
    err.code = 1 as unknown as string;
    execFileCallbacks[0].callback(
      err,
      "",
      "Persisting failed: Another write batch or compaction is already active",
    );

    // Second write should still proceed
    await vi.waitFor(() => {
      expect(execFileCallbacks.length).toBe(2);
    });

    execFileCallbacks[1].callback(null, "created K-0002", "");

    const [r1, r2] = await Promise.all([write1, write2]);
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(true);
    expect(_pendingWriteCount(repo)).toBe(0);
  });
});
