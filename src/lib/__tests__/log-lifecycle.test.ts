import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readdir, stat, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";

import { cleanupLogs } from "@/lib/log-lifecycle";

let tempDir: string;

/** Create a file with given content and optionally backdate its mtime. */
async function createLogFile(
  relativePath: string,
  content: string,
  ageDays = 0,
): Promise<string> {
  const fullPath = join(tempDir, relativePath);
  const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(fullPath, content, "utf-8");

  if (ageDays > 0) {
    const mtime = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
    const { utimes } = await import("node:fs/promises");
    await utimes(fullPath, mtime, mtime);
  }

  return fullPath;
}

/** Read .jsonl.gz file and return decompressed content. */
async function readGzFile(filePath: string): Promise<string> {
  const chunks: Buffer[] = [];
  const collector = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
  await pipeline(createReadStream(filePath), createGunzip(), collector);
  return Buffer.concat(chunks).toString("utf-8");
}

/** Check if a path exists. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Get total size of all files under a directory. */
async function totalSize(dir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const entryPath = join(entry.parentPath ?? entry.path, entry.name);
        const s = await stat(entryPath);
        total += s.size;
      }
    }
  } catch {
    // dir doesn't exist
  }
  return total;
}

describe("cleanupLogs", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "log-lifecycle-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("does nothing when log root does not exist", async () => {
    const nonExistent = join(tempDir, "does-not-exist");
    await expect(
      cleanupLogs({ logRoot: nonExistent }),
    ).resolves.toBeUndefined();
  });

  it("does nothing when log root is empty", async () => {
    await expect(
      cleanupLogs({ logRoot: tempDir }),
    ).resolves.toBeUndefined();
  });

  it("leaves recent files untouched", async () => {
    const file = await createLogFile(
      "my-repo/2026-02-18/session-1.jsonl",
      '{"kind":"session_start"}\n',
      0, // today
    );

    await cleanupLogs({ logRoot: tempDir });

    expect(await pathExists(file)).toBe(true);
    expect(await pathExists(file + ".gz")).toBe(false);
  });

  it("compresses .jsonl files older than compressAfterDays", async () => {
    const content = '{"kind":"session_start"}\n{"kind":"session_end"}\n';
    const file = await createLogFile(
      "my-repo/2026-02-14/session-old.jsonl",
      content,
      5, // 5 days old
    );

    await cleanupLogs({
      logRoot: tempDir,
      compressAfterDays: 3,
      deleteAfterDays: 30,
    });

    // Original should be gone, .gz should exist
    expect(await pathExists(file)).toBe(false);
    expect(await pathExists(file + ".gz")).toBe(true);

    // Verify compressed content is correct
    const decompressed = await readGzFile(file + ".gz");
    expect(decompressed).toBe(content);

    // Verify mtime is preserved so age-based deletion works correctly
    const gzStat = await stat(file + ".gz");
    const expectedAge = 5 * 24 * 60 * 60 * 1000;
    const actualAge = Date.now() - gzStat.mtimeMs;
    // Allow 60s tolerance for test execution time
    expect(actualAge).toBeGreaterThan(expectedAge - 60_000);
    expect(actualAge).toBeLessThan(expectedAge + 60_000);
  });

  it("does not re-compress already-compressed .jsonl.gz files", async () => {
    const gzFile = await createLogFile(
      "my-repo/2026-02-14/session-old.jsonl.gz",
      "fake-gz-data",
      5,
    );

    await cleanupLogs({
      logRoot: tempDir,
      compressAfterDays: 3,
      deleteAfterDays: 30,
    });

    // .gz file should still exist, no .gz.gz created
    expect(await pathExists(gzFile)).toBe(true);
    expect(await pathExists(gzFile + ".gz")).toBe(false);
  });

  it("deletes files older than deleteAfterDays", async () => {
    const jsonlFile = await createLogFile(
      "my-repo/2025-01-01/session-ancient.jsonl",
      '{"kind":"old"}\n',
      60,
    );
    const gzFile = await createLogFile(
      "my-repo/2025-01-01/session-ancient2.jsonl.gz",
      "fake-gz",
      60,
    );

    await cleanupLogs({
      logRoot: tempDir,
      compressAfterDays: 3,
      deleteAfterDays: 30,
    });

    expect(await pathExists(jsonlFile)).toBe(false);
    expect(await pathExists(gzFile)).toBe(false);
  });

  it("removes empty date directories after cleanup", async () => {
    await createLogFile(
      "my-repo/2025-01-01/session-ancient.jsonl",
      '{"kind":"old"}\n',
      60,
    );

    await cleanupLogs({
      logRoot: tempDir,
      deleteAfterDays: 30,
    });

    const dateDir = join(tempDir, "my-repo", "2025-01-01");
    expect(await pathExists(dateDir)).toBe(false);
  });

  it("removes empty repo-slug directories after cleanup", async () => {
    await createLogFile(
      "dead-repo/2025-01-01/session-1.jsonl",
      '{"kind":"old"}\n',
      60,
    );

    await cleanupLogs({
      logRoot: tempDir,
      deleteAfterDays: 30,
    });

    const repoDir = join(tempDir, "dead-repo");
    expect(await pathExists(repoDir)).toBe(false);
  });

  it("enforces maxTotalBytes by deleting oldest files first", async () => {
    // Create 3 files: oldest, middle, newest
    // Each ~100 bytes
    await createLogFile(
      "repo/2026-02-10/oldest.jsonl",
      "A".repeat(100),
      8,
    );
    await createLogFile(
      "repo/2026-02-14/middle.jsonl",
      "B".repeat(100),
      4,
    );
    await createLogFile(
      "repo/2026-02-18/newest.jsonl",
      "C".repeat(100),
      0,
    );

    await cleanupLogs({
      logRoot: tempDir,
      compressAfterDays: 999, // disable compression for this test
      deleteAfterDays: 999,   // disable age deletion for this test
      maxTotalBytes: 200,     // only room for ~2 files
    });

    // Oldest should be deleted, middle and newest should survive
    const oldest = join(tempDir, "repo/2026-02-10/oldest.jsonl");
    const middle = join(tempDir, "repo/2026-02-14/middle.jsonl");
    const newest = join(tempDir, "repo/2026-02-18/newest.jsonl");

    expect(await pathExists(oldest)).toBe(false);
    expect(await pathExists(middle)).toBe(true);
    expect(await pathExists(newest)).toBe(true);
  });

  it("applies compression before size cap", async () => {
    // File is 5 days old (should compress), and total should stay under cap
    const content = "X".repeat(500);
    await createLogFile(
      "repo/2026-02-13/session.jsonl",
      content,
      5,
    );

    await cleanupLogs({
      logRoot: tempDir,
      compressAfterDays: 3,
      deleteAfterDays: 30,
      maxTotalBytes: 10_000, // plenty of room after compression
    });

    const original = join(tempDir, "repo/2026-02-13/session.jsonl");
    const compressed = original + ".gz";

    expect(await pathExists(original)).toBe(false);
    expect(await pathExists(compressed)).toBe(true);

    // Compressed should be smaller than original
    const compressedStat = await stat(compressed);
    expect(compressedStat.size).toBeLessThan(500);
  });

  it("handles multiple repo slugs", async () => {
    await createLogFile(
      "repo-a/2025-01-01/s1.jsonl",
      "old-a",
      60,
    );
    await createLogFile(
      "repo-b/2025-01-01/s1.jsonl",
      "old-b",
      60,
    );
    await createLogFile(
      "repo-c/2026-02-18/s1.jsonl",
      "new-c",
      0,
    );

    await cleanupLogs({
      logRoot: tempDir,
      deleteAfterDays: 30,
    });

    expect(await pathExists(join(tempDir, "repo-a"))).toBe(false);
    expect(await pathExists(join(tempDir, "repo-b"))).toBe(false);
    expect(await pathExists(join(tempDir, "repo-c/2026-02-18/s1.jsonl"))).toBe(true);
  });

  it("ignores non-log files in log directories", async () => {
    // Create a non-log file alongside a log file
    await createLogFile("repo/2025-01-01/notes.txt", "not a log", 60);
    await createLogFile("repo/2025-01-01/session.jsonl", "log data", 60);

    await cleanupLogs({
      logRoot: tempDir,
      deleteAfterDays: 30,
    });

    // .jsonl deleted, .txt left alone
    expect(await pathExists(join(tempDir, "repo/2025-01-01/session.jsonl"))).toBe(false);
    expect(await pathExists(join(tempDir, "repo/2025-01-01/notes.txt"))).toBe(true);
  });

  it("size cap deletes enough files to get under the limit", async () => {
    // Create 5 files of 100 bytes each = 500 total
    for (let i = 0; i < 5; i++) {
      await createLogFile(
        `repo/2026-02-${String(10 + i).padStart(2, "0")}/s${i}.jsonl`,
        "D".repeat(100),
        8 - i, // oldest first
      );
    }

    await cleanupLogs({
      logRoot: tempDir,
      compressAfterDays: 999,
      deleteAfterDays: 999,
      maxTotalBytes: 250,
    });

    const remaining = await totalSize(tempDir);
    expect(remaining).toBeLessThanOrEqual(250);
  });
});
