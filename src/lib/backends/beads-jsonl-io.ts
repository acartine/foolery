/**
 * JSONL file I/O helpers for the BeadsBackend.
 *
 * Handles reading, parsing, and writing the .beads/issues.jsonl file
 * format. Each line is one JSON record terminated by a newline.
 */

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { RawBead } from "./beads-jsonl-dto";

// ── Path resolution ─────────────────────────────────────────────

export function resolveJsonlPath(repoPath: string): string {
  return join(repoPath, ".beads", "issues.jsonl");
}

// ── Read ────────────────────────────────────────────────────────

/**
 * Read and parse all records from a JSONL file.
 * Returns an empty array if the file doesn't exist or is empty.
 */
export async function readJsonlFile(filePath: string): Promise<RawBead[]> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  const records: RawBead[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as RawBead);
    } catch {
      // Skip malformed lines
    }
  }
  return records;
}

// ── Write ───────────────────────────────────────────────────────

/**
 * Write all records to a JSONL file, overwriting the existing content.
 * Creates the parent directory if it does not exist.
 */
export async function writeJsonlFile(
  filePath: string,
  records: RawBead[],
): Promise<void> {
  const dir = dirname(filePath);
  try {
    await access(dir);
  } catch {
    await mkdir(dir, { recursive: true });
  }

  const lines = records.map((r) => JSON.stringify(r));
  await writeFile(filePath, lines.join("\n") + "\n", "utf-8");
}
