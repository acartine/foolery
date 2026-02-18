import { readdir, stat, unlink, rmdir, utimes } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

/**
 * Log lifecycle management for agent interaction logs.
 *
 * Provides automatic compression, deletion, and size-cap enforcement
 * for JSONL log files produced by the interaction logger.
 *
 * Directory layout (mirrored from interaction-logger.ts):
 *   {logDir}/{repo-slug}/{YYYY-MM-DD}/{session-id}.jsonl
 */

export interface CleanupOptions {
  /** Gzip .jsonl files older than this many days. Default: 3 */
  compressAfterDays?: number;
  /** Delete all log files older than this many days. Default: 30 */
  deleteAfterDays?: number;
  /** Maximum total bytes across all log files. Default: 500 MB */
  maxTotalBytes?: number;
  /** Override log root directory (primarily for testing). */
  logRoot?: string;
}

interface FileEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

const DEFAULT_COMPRESS_DAYS = 3;
const DEFAULT_DELETE_DAYS = 30;
const DEFAULT_MAX_BYTES = 500 * 1024 * 1024; // 500 MB
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function resolveLogRoot(): string {
  if (process.env.NODE_ENV === "development") {
    return join(process.cwd(), ".foolery-logs");
  }
  return join(homedir(), ".config", "foolery", "logs");
}

/**
 * Walk all log files under the given root directory.
 * Returns entries for .jsonl and .jsonl.gz files with stat info.
 */
async function walkLogFiles(root: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  let repoSlugs: string[];
  try {
    repoSlugs = await readdir(root);
  } catch {
    return entries; // Root doesn't exist yet, nothing to clean
  }

  for (const slug of repoSlugs) {
    const slugDir = join(root, slug);
    await collectFromSlugDir(slugDir, entries);
  }
  return entries;
}

async function collectFromSlugDir(
  slugDir: string,
  entries: FileEntry[],
): Promise<void> {
  let dateDirs: string[];
  try {
    dateDirs = await readdir(slugDir);
  } catch {
    return;
  }

  for (const dateDir of dateDirs) {
    const datePath = join(slugDir, dateDir);
    await collectFromDateDir(datePath, entries);
  }
}

async function collectFromDateDir(
  datePath: string,
  entries: FileEntry[],
): Promise<void> {
  let files: string[];
  try {
    files = await readdir(datePath);
  } catch {
    return;
  }

  for (const file of files) {
    if (!file.endsWith(".jsonl") && !file.endsWith(".jsonl.gz")) continue;
    const filePath = join(datePath, file);
    try {
      const s = await stat(filePath);
      if (s.isFile()) {
        entries.push({ path: filePath, size: s.size, mtimeMs: s.mtimeMs });
      }
    } catch {
      // File may have been removed concurrently; skip
    }
  }
}

/**
 * Compress a .jsonl file to .jsonl.gz, preserving the original mtime,
 * and remove the original. This ensures the compressed file's age is
 * correctly evaluated by subsequent delete-after-days checks.
 */
async function compressFile(filePath: string): Promise<string> {
  const originalStat = await stat(filePath);
  const gzPath = filePath + ".gz";
  const source = createReadStream(filePath);
  const destination = createWriteStream(gzPath);
  const gzip = createGzip();
  await pipeline(source, gzip, destination);
  // Preserve original timestamps so age-based deletion works correctly
  await utimes(gzPath, originalStat.atime, originalStat.mtime);
  await unlink(filePath);
  return gzPath;
}

/**
 * Remove empty date directories under repo-slug directories.
 */
async function pruneEmptyDateDirs(root: string): Promise<void> {
  let repoSlugs: string[];
  try {
    repoSlugs = await readdir(root);
  } catch {
    return;
  }

  for (const slug of repoSlugs) {
    const slugDir = join(root, slug);
    await pruneEmptyDirsIn(slugDir);
  }
}

async function pruneEmptyDirsIn(slugDir: string): Promise<void> {
  let dateDirs: string[];
  try {
    dateDirs = await readdir(slugDir);
  } catch {
    return;
  }

  for (const dateDir of dateDirs) {
    const datePath = join(slugDir, dateDir);
    try {
      const remaining = await readdir(datePath);
      if (remaining.length === 0) {
        await rmdir(datePath);
      }
    } catch {
      // directory may already be gone
    }
  }

  // Also remove the slug dir if now empty
  try {
    const remaining = await readdir(slugDir);
    if (remaining.length === 0) {
      await rmdir(slugDir);
    }
  } catch {
    // ignore
  }
}

/**
 * Apply age-based compression and deletion policies.
 * Returns the list of files remaining after age-based cleanup.
 */
function applyAgePolicies(
  entries: FileEntry[],
  now: number,
  compressDays: number,
  deleteDays: number,
): { toCompress: FileEntry[]; toDelete: FileEntry[]; kept: FileEntry[] } {
  const compressThreshold = now - compressDays * MS_PER_DAY;
  const deleteThreshold = now - deleteDays * MS_PER_DAY;

  const toDelete: FileEntry[] = [];
  const toCompress: FileEntry[] = [];
  const kept: FileEntry[] = [];

  for (const entry of entries) {
    if (entry.mtimeMs < deleteThreshold) {
      toDelete.push(entry);
    } else if (
      entry.mtimeMs < compressThreshold &&
      entry.path.endsWith(".jsonl")
    ) {
      toCompress.push(entry);
      // Not added to kept -- compressed versions will be added separately
    } else {
      kept.push(entry);
    }
  }

  return { toCompress, toDelete, kept };
}

/**
 * Enforce max total bytes by deleting oldest files first.
 * Returns early without sorting if already under the cap.
 */
function selectForSizeCap(
  entries: FileEntry[],
  maxBytes: number,
): FileEntry[] {
  let total = entries.reduce((sum, e) => sum + e.size, 0);
  if (total <= maxBytes) return [];

  // Only sort when we actually need to delete
  const sorted = [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs);
  const toDelete: FileEntry[] = [];

  for (const entry of sorted) {
    if (total <= maxBytes) break;
    toDelete.push(entry);
    total -= entry.size;
  }

  return toDelete;
}

/**
 * Run log lifecycle cleanup: compress old files, delete expired files,
 * enforce total size cap, and prune empty directories.
 *
 * Safe to call concurrently -- individual file operations may race but
 * will not corrupt data (worst case: a file is skipped this cycle).
 */
export async function cleanupLogs(options?: CleanupOptions): Promise<void> {
  const root = options?.logRoot ?? resolveLogRoot();
  const compressDays = options?.compressAfterDays ?? DEFAULT_COMPRESS_DAYS;
  const deleteDays = options?.deleteAfterDays ?? DEFAULT_DELETE_DAYS;
  const maxBytes = options?.maxTotalBytes ?? DEFAULT_MAX_BYTES;
  const now = Date.now();

  const allEntries = await walkLogFiles(root);

  // Phase 1: Age-based deletion and compression
  const { toCompress, toDelete, kept } = applyAgePolicies(
    allEntries,
    now,
    compressDays,
    deleteDays,
  );

  // Delete expired files
  for (const entry of toDelete) {
    try {
      await unlink(entry.path);
    } catch {
      // File may already be gone
    }
  }

  // Compress old .jsonl files and collect their new entries
  const afterCompress: FileEntry[] = [];
  for (const entry of toCompress) {
    try {
      const gzPath = await compressFile(entry.path);
      const gzStat = await stat(gzPath);
      afterCompress.push({
        path: gzPath,
        size: gzStat.size,
        mtimeMs: entry.mtimeMs,
      });
    } catch {
      // Compression failed; original file still exists, keep it
      afterCompress.push(entry);
    }
  }

  // Final file list = kept (untouched) + afterCompress (newly compressed)
  // No overlap possible: kept excludes files that were in toCompress
  const finalEntries = [...kept, ...afterCompress];

  // Phase 2: Size-cap enforcement
  const sizeCapDeletes = selectForSizeCap(finalEntries, maxBytes);
  for (const entry of sizeCapDeletes) {
    try {
      await unlink(entry.path);
    } catch {
      // File may already be gone
    }
  }

  // Phase 3: Prune empty date directories
  await pruneEmptyDateDirs(root);
}
