import {
  describe, it, expect, beforeEach, afterEach,
} from "vitest";
import {
  mkdtemp, mkdir, writeFile, readdir, stat, rm,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";

import { cleanupLogs } from "@/lib/log-lifecycle";

let tempDir: string;

/** Create a file with given content; optionally backdate mtime. */
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
    const mtime = new Date(
      Date.now() - ageDays * 24 * 60 * 60 * 1000,
    );
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
  await pipeline(
    createReadStream(filePath), createGunzip(), collector,
  );
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
    const entries = await readdir(
      dir, { recursive: true, withFileTypes: true },
    );
    for (const entry of entries) {
      if (entry.isFile()) {
        const entryPath = join(
          entry.parentPath ?? entry.path, entry.name,
        );
        const s = await stat(entryPath);
        total += s.size;
      }
    }
  } catch {
    // dir doesn't exist
  }
  return total;
}

function setupTempDir(): void {
  beforeEach(async () => {
    tempDir = await mkdtemp(
      join(tmpdir(), "log-lifecycle-test-"),
    );
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
}

describe("cleanupLogs: no-op and recent files", () => {
  setupTempDir();

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
      0,
    );

    await cleanupLogs({ logRoot: tempDir });

    expect(await pathExists(file)).toBe(true);
    expect(await pathExists(file + ".gz")).toBe(false);
  });
});

describe("cleanupLogs: compression", () => {
  setupTempDir();

  it("compresses .jsonl files older than threshold", async () => {
    const content =
      '{"kind":"session_start"}\n{"kind":"session_end"}\n';
    const file = await createLogFile(
      "my-repo/2026-02-14/session-old.jsonl", content, 5,
    );

    await cleanupLogs({
      logRoot: tempDir,
      compressAfterDays: 3,
      deleteAfterDays: 30,
    });

    expect(await pathExists(file)).toBe(false);
    expect(await pathExists(file + ".gz")).toBe(true);

    const decompressed = await readGzFile(file + ".gz");
    expect(decompressed).toBe(content);

    const gzStat = await stat(file + ".gz");
    const expectedAge = 5 * 24 * 60 * 60 * 1000;
    const actualAge = Date.now() - gzStat.mtimeMs;
    expect(actualAge).toBeGreaterThan(expectedAge - 60_000);
    expect(actualAge).toBeLessThan(expectedAge + 60_000);
  });

  it("does not re-compress .jsonl.gz files", async () => {
    const gzFile = await createLogFile(
      "my-repo/2026-02-14/session-old.jsonl.gz",
      "fake-gz-data", 5,
    );

    await cleanupLogs({
      logRoot: tempDir,
      compressAfterDays: 3,
      deleteAfterDays: 30,
    });

    expect(await pathExists(gzFile)).toBe(true);
    expect(await pathExists(gzFile + ".gz")).toBe(false);
  });

  it("compresses .stdout.log files", async () => {
    const content = "raw stdout output here\n";
    const file = await createLogFile(
      "my-repo/2026-02-14/session-old.stdout.log", content, 5,
    );

    await cleanupLogs({
      logRoot: tempDir,
      compressAfterDays: 3,
      deleteAfterDays: 30,
    });

    expect(await pathExists(file)).toBe(false);
    expect(await pathExists(file + ".gz")).toBe(true);
    expect(await readGzFile(file + ".gz")).toBe(content);
  });

  it("compresses .stderr.log files", async () => {
    const content = "raw stderr output here\n";
    const file = await createLogFile(
      "my-repo/2026-02-14/session-old.stderr.log", content, 5,
    );

    await cleanupLogs({
      logRoot: tempDir,
      compressAfterDays: 3,
      deleteAfterDays: 30,
    });

    expect(await pathExists(file)).toBe(false);
    expect(await pathExists(file + ".gz")).toBe(true);
    expect(await readGzFile(file + ".gz")).toBe(content);
  });

  it("applies compression before size cap", async () => {
    const content = "X".repeat(500);
    await createLogFile(
      "repo/2026-02-13/session.jsonl", content, 5,
    );

    await cleanupLogs({
      logRoot: tempDir,
      compressAfterDays: 3,
      deleteAfterDays: 30,
      maxTotalBytes: 10_000,
    });

    const original = join(
      tempDir, "repo/2026-02-13/session.jsonl",
    );
    const compressed = original + ".gz";

    expect(await pathExists(original)).toBe(false);
    expect(await pathExists(compressed)).toBe(true);

    const compressedStat = await stat(compressed);
    expect(compressedStat.size).toBeLessThan(500);
  });
});

describe("cleanupLogs: deletion and directory cleanup", () => {
  setupTempDir();

  it("deletes files older than deleteAfterDays", async () => {
    const jsonlFile = await createLogFile(
      "my-repo/2025-01-01/session-ancient.jsonl",
      '{"kind":"old"}\n', 60,
    );
    const gzFile = await createLogFile(
      "my-repo/2025-01-01/session-ancient2.jsonl.gz",
      "fake-gz", 60,
    );

    await cleanupLogs({
      logRoot: tempDir,
      compressAfterDays: 3,
      deleteAfterDays: 30,
    });

    expect(await pathExists(jsonlFile)).toBe(false);
    expect(await pathExists(gzFile)).toBe(false);
  });

  it("removes empty date directories", async () => {
    await createLogFile(
      "my-repo/2025-01-01/session-ancient.jsonl",
      '{"kind":"old"}\n', 60,
    );

    await cleanupLogs({
      logRoot: tempDir, deleteAfterDays: 30,
    });

    const dateDir = join(tempDir, "my-repo", "2025-01-01");
    expect(await pathExists(dateDir)).toBe(false);
  });

  it("removes empty repo-slug directories", async () => {
    await createLogFile(
      "dead-repo/2025-01-01/session-1.jsonl",
      '{"kind":"old"}\n', 60,
    );

    await cleanupLogs({
      logRoot: tempDir, deleteAfterDays: 30,
    });

    const repoDir = join(tempDir, "dead-repo");
    expect(await pathExists(repoDir)).toBe(false);
  });

  it("deletes old .stdout.log and .stderr.log files", async () => {
    const stdoutFile = await createLogFile(
      "my-repo/2025-01-01/session-ancient.stdout.log",
      "old stdout\n", 60,
    );
    const stderrFile = await createLogFile(
      "my-repo/2025-01-01/session-ancient.stderr.log",
      "old stderr\n", 60,
    );

    await cleanupLogs({
      logRoot: tempDir,
      compressAfterDays: 3,
      deleteAfterDays: 30,
    });

    expect(await pathExists(stdoutFile)).toBe(false);
    expect(await pathExists(stderrFile)).toBe(false);
  });

});

describe("cleanupLogs: multi-repo and non-log files", () => {
  setupTempDir();

  it("handles multiple repo slugs", async () => {
    await createLogFile(
      "repo-a/2025-01-01/s1.jsonl", "old-a", 60,
    );
    await createLogFile(
      "repo-b/2025-01-01/s1.jsonl", "old-b", 60,
    );
    await createLogFile(
      "repo-c/2026-02-18/s1.jsonl", "new-c", 0,
    );

    await cleanupLogs({
      logRoot: tempDir, deleteAfterDays: 30,
    });

    expect(
      await pathExists(join(tempDir, "repo-a")),
    ).toBe(false);
    expect(
      await pathExists(join(tempDir, "repo-b")),
    ).toBe(false);
    expect(
      await pathExists(
        join(tempDir, "repo-c/2026-02-18/s1.jsonl"),
      ),
    ).toBe(true);
  });

  it("ignores non-log files in log directories", async () => {
    await createLogFile(
      "repo/2025-01-01/notes.txt", "not a log", 60,
    );
    await createLogFile(
      "repo/2025-01-01/session.jsonl", "log data", 60,
    );

    await cleanupLogs({
      logRoot: tempDir, deleteAfterDays: 30,
    });

    expect(await pathExists(
      join(tempDir, "repo/2025-01-01/session.jsonl"),
    )).toBe(false);
    expect(await pathExists(
      join(tempDir, "repo/2025-01-01/notes.txt"),
    )).toBe(true);
  });
});

describe("cleanupLogs: size cap enforcement", () => {
  setupTempDir();

  it("enforces maxTotalBytes by deleting oldest first", async () => {
    await createLogFile(
      "repo/2026-02-10/oldest.jsonl", "A".repeat(100), 8,
    );
    await createLogFile(
      "repo/2026-02-14/middle.jsonl", "B".repeat(100), 4,
    );
    await createLogFile(
      "repo/2026-02-18/newest.jsonl", "C".repeat(100), 0,
    );

    await cleanupLogs({
      logRoot: tempDir,
      compressAfterDays: 999,
      deleteAfterDays: 999,
      maxTotalBytes: 200,
    });

    const oldest = join(
      tempDir, "repo/2026-02-10/oldest.jsonl",
    );
    const middle = join(
      tempDir, "repo/2026-02-14/middle.jsonl",
    );
    const newest = join(
      tempDir, "repo/2026-02-18/newest.jsonl",
    );

    expect(await pathExists(oldest)).toBe(false);
    expect(await pathExists(middle)).toBe(true);
    expect(await pathExists(newest)).toBe(true);
  });

  it("deletes enough files to get under the limit", async () => {
    for (let i = 0; i < 5; i++) {
      await createLogFile(
        `repo/2026-02-${String(10 + i).padStart(2, "0")}/s${i}.jsonl`,
        "D".repeat(100),
        8 - i,
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
