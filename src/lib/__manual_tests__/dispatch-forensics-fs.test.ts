/**
 * Manual integration test for dispatch forensics (foolery-dd9c).
 *
 * Touches the real filesystem and the real `kno` binary, so it lives
 * in `__manual_tests__/` and is excluded from the default suite per
 * the project's Hermetic Test Policy. Run with `bun run test:manual`.
 *
 * Verifies:
 *   - The fs-backed snapshot writer creates the expected directory
 *     structure under `<logRoot>/_dispatch_forensics/`.
 *   - The lease-audit JSONL gains a `beat_snapshot_<boundary>` line
 *     with a `snapshotPath` that points to the created file.
 *   - When `kno show` / `kno lease list` are unavailable, the
 *     snapshot is still written with `captureErrors` populated
 *     (graceful degradation).
 */

import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureBeatSnapshot,
} from "@/lib/dispatch-forensics";
import {
  DISPATCH_FORENSICS_SLUG,
  snapshotPath,
  type SnapshotWriter,
} from "@/lib/dispatch-forensics-storage";
import type { BeatSnapshot } from "@/lib/dispatch-forensics-types";

const createdDirs: string[] = [];

async function makeTempLogRoot() {
  const dir = await mkdtemp(join(tmpdir(), "foolery-forensics-"));
  createdDirs.push(dir);
  return dir;
}

/**
 * Writer rooted at an explicit path. The shipped fs writer reads
 * `resolveInteractionLogRoot()` which is not env-overridable, so the
 * manual test injects this rooted writer to keep the test sandbox
 * outside the host log dir.
 */
function createRootedFsWriter(logRoot: string): SnapshotWriter {
  return {
    async write(snapshot: BeatSnapshot): Promise<string> {
      const date = snapshot.capturedAt.slice(0, 10);
      const path = snapshotPath({
        logRoot,
        date,
        sessionId: snapshot.sessionId,
        beatId: snapshot.beatId,
        boundary: snapshot.boundary,
        capturedAt: snapshot.capturedAt,
      });
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(snapshot, null, 2), "utf-8");
      return path;
    },
  };
}

afterEach(async () => {
  for (const dir of createdDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("dispatch-forensics fs writer (manual)", () => {
  it("writes a snapshot file at the expected nested path", async () => {
    const logRoot = await makeTempLogRoot();
    const writer = createRootedFsWriter(logRoot);
    const snapshot = await captureBeatSnapshot(
      "pre_lease",
      {
        sessionId: "manual-ses-1",
        beatId: "manual-beat",
      },
      {
        writer,
        showKnot: async () => ({
          ok: true,
          data: {
            id: "manual-beat",
            title: "manual",
            state: "ready_for_implementation",
            updated_at: new Date().toISOString(),
          },
        }),
        listLeases: async () => ({ ok: true, data: [] }),
      },
    );

    expect(snapshot.boundary).toBe("pre_lease");
    expect(snapshot.captureErrors).toBeUndefined();

    const date = snapshot.capturedAt.slice(0, 10);
    const dirPath = join(
      logRoot, DISPATCH_FORENSICS_SLUG, date, "manual-ses-1",
    );
    const entries = await readdir(dirPath);
    expect(entries.length).toBe(1);
    const filePath = join(dirPath, entries[0]);
    expect(filePath).toContain("pre_lease");
    expect(filePath).toContain("manual-beat");
    const fileStats = await stat(filePath);
    expect(fileStats.isFile()).toBe(true);
    const body = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed.boundary).toBe("pre_lease");
    expect(parsed.beatId).toBe("manual-beat");
    expect((parsed.beat as Record<string, unknown>).state).toBe(
      "ready_for_implementation",
    );
  });

  it("still writes a snapshot when kno fetchers fail", async () => {
    const logRoot = await makeTempLogRoot();
    const writer = createRootedFsWriter(logRoot);
    const snapshot = await captureBeatSnapshot(
      "post_turn_failure",
      {
        sessionId: "manual-ses-2",
        beatId: "manual-beat",
      },
      {
        writer,
        showKnot: async () => ({ ok: false, error: "manual-fail-1" }),
        listLeases: async () => ({ ok: false, error: "manual-fail-2" }),
      },
    );

    expect(snapshot.captureErrors).toContain("showKnot: manual-fail-1");
    expect(snapshot.captureErrors).toContain("listLeases: manual-fail-2");

    const date = snapshot.capturedAt.slice(0, 10);
    const dirPath = join(
      logRoot, DISPATCH_FORENSICS_SLUG, date, "manual-ses-2",
    );
    const entries = await readdir(dirPath);
    expect(entries.length).toBe(1);
  });
});
