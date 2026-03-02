/**
 * Additional coverage tests for agent-history.ts.
 * Targets uncovered parse paths: readLogFile with .gz, empty logs,
 * session with invalid interactionType, session with empty beadIds,
 * response without raw field, sessions sorted by time.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { gzip as gzipCallback } from "node:zlib";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readAgentHistory } from "@/lib/agent-history";

const gzip = promisify(gzipCallback);

let tempDir: string;

async function writeLog(
  root: string,
  relativePath: string,
  lines: Array<Record<string, unknown>>,
): Promise<void> {
  const fullPath = join(root, relativePath);
  const dir = fullPath.slice(0, fullPath.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(
    fullPath,
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    "utf-8",
  );
}

async function writeGzLog(
  root: string,
  relativePath: string,
  lines: Array<Record<string, unknown>>,
): Promise<void> {
  const fullPath = join(root, relativePath);
  const dir = fullPath.slice(0, fullPath.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  const content = lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
  const compressed = await gzip(Buffer.from(content, "utf-8"));
  await writeFile(fullPath, compressed);
}

describe("readAgentHistory (additional coverage)", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agent-history-cov-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reads .jsonl.gz compressed log files", async () => {
    await writeGzLog(tempDir, "repo-a/2026-02-20/compressed.jsonl.gz", [
      {
        kind: "session_start",
        ts: "2026-02-20T10:00:00.000Z",
        sessionId: "compressed-1",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beadIds: ["gz-bead"],
      },
      {
        kind: "session_end",
        ts: "2026-02-20T10:01:00.000Z",
        sessionId: "compressed-1",
        status: "completed",
        exitCode: 0,
      },
    ]);

    const history = await readAgentHistory({ logRoot: tempDir });
    expect(history.beats.map((b) => b.beadId)).toContain("gz-bead");
  });

  it("skips sessions with invalid interactionType", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/invalid-type.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T10:00:00.000Z",
        sessionId: "invalid-type-1",
        interactionType: "unknown_type",
        repoPath: "/tmp/repo-a",
        beadIds: ["bead-1"],
      },
    ]);

    const history = await readAgentHistory({ logRoot: tempDir });
    expect(history.beats).toHaveLength(0);
  });

  it("skips sessions with empty repoPath", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/no-repo.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T10:00:00.000Z",
        sessionId: "no-repo-1",
        interactionType: "take",
        repoPath: "",
        beadIds: ["bead-1"],
      },
    ]);

    const history = await readAgentHistory({ logRoot: tempDir });
    expect(history.beats).toHaveLength(0);
  });

  it("skips sessions with empty beadIds", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/no-beads.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T10:00:00.000Z",
        sessionId: "no-beads-1",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beadIds: [],
      },
    ]);

    const history = await readAgentHistory({ logRoot: tempDir });
    expect(history.beats).toHaveLength(0);
  });

  it("handles response lines without raw field", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/no-raw.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T10:00:00.000Z",
        sessionId: "no-raw-1",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beadIds: ["bead-nr"],
      },
      {
        kind: "response",
        ts: "2026-02-20T10:00:01.000Z",
        sessionId: "no-raw-1",
        parsed: { type: "text", text: "hello" },
      },
      {
        kind: "session_end",
        ts: "2026-02-20T10:00:02.000Z",
        sessionId: "no-raw-1",
        status: "completed",
        exitCode: 0,
      },
    ]);

    const history = await readAgentHistory({
      logRoot: tempDir,
      beadId: "bead-nr",
      beadRepoPath: "/tmp/repo-a",
    });

    const responses = history.sessions[0]?.entries.filter((e) => e.kind === "response") ?? [];
    expect(responses).toHaveLength(1);
  });

  it("handles malformed JSON lines gracefully", async () => {
    const fullPath = join(tempDir, "repo-a/2026-02-20/malformed.jsonl");
    const dir = fullPath.slice(0, fullPath.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });
    const content = [
      JSON.stringify({
        kind: "session_start",
        ts: "2026-02-20T10:00:00.000Z",
        sessionId: "malf-1",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beadIds: ["bead-m"],
      }),
      "this is not json{{{",
      JSON.stringify({
        kind: "session_end",
        ts: "2026-02-20T10:01:00.000Z",
        sessionId: "malf-1",
        status: "completed",
        exitCode: 0,
      }),
    ].join("\n") + "\n";
    await writeFile(fullPath, content, "utf-8");

    const history = await readAgentHistory({ logRoot: tempDir });
    expect(history.beats.map((b) => b.beadId)).toContain("bead-m");
  });

  it("increments session counts for same bead across multiple files", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/s1.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T10:00:00.000Z",
        sessionId: "s1",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beadIds: ["shared-bead"],
      },
    ]);
    await writeLog(tempDir, "repo-a/2026-02-20/s2.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T11:00:00.000Z",
        sessionId: "s2",
        interactionType: "scene",
        repoPath: "/tmp/repo-a",
        beadIds: ["shared-bead"],
      },
    ]);

    const history = await readAgentHistory({ logRoot: tempDir });
    const beat = history.beats.find((b) => b.beadId === "shared-bead");
    expect(beat?.sessionCount).toBe(2);
    expect(beat?.takeCount).toBe(1);
    expect(beat?.sceneCount).toBe(1);
  });

  it("returns empty results for nonexistent log root", async () => {
    const history = await readAgentHistory({
      logRoot: join(tempDir, "nonexistent"),
    });
    expect(history.beats).toEqual([]);
    expect(history.sessions).toEqual([]);
  });

  it("extracts parent bead titles from prompt", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/parent.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T10:00:00.000Z",
        sessionId: "parent-1",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beadIds: ["parent-bead"],
      },
      {
        kind: "prompt",
        ts: "2026-02-20T10:00:01.000Z",
        sessionId: "parent-1",
        prompt: "Parent ID: parent-bead\nParent Title: The Parent Beat",
      },
    ]);

    const history = await readAgentHistory({ logRoot: tempDir });
    const beat = history.beats.find((b) => b.beadId === "parent-bead");
    expect(beat?.title).toBe("The Parent Beat");
  });

  it("handles session with null exitCode", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/null-exit.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T10:00:00.000Z",
        sessionId: "null-exit-1",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beadIds: ["exit-bead"],
      },
      {
        kind: "session_end",
        ts: "2026-02-20T10:01:00.000Z",
        sessionId: "null-exit-1",
        status: "killed",
        exitCode: null,
      },
    ]);

    const history = await readAgentHistory({
      logRoot: tempDir,
      beadId: "exit-bead",
      beadRepoPath: "/tmp/repo-a",
    });
    expect(history.sessions[0]?.exitCode).toBeNull();
  });
});
