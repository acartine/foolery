import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readAgentHistory } from "@/lib/agent-history";

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

describe("readAgentHistory", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agent-history-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns take/scene beat summaries sorted by most recent activity", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/term-a.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T10:00:00.000Z",
        sessionId: "term-a",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beadIds: ["foo-1"],
      },
      {
        kind: "prompt",
        ts: "2026-02-20T10:00:01.000Z",
        sessionId: "term-a",
        prompt: "ID: foo-1\nTitle: First beat",
        source: "initial",
      },
      {
        kind: "session_end",
        ts: "2026-02-20T10:03:00.000Z",
        sessionId: "term-a",
        status: "completed",
        exitCode: 0,
      },
    ]);

    await writeLog(tempDir, "repo-a/2026-02-20/term-b.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T11:00:00.000Z",
        sessionId: "term-b",
        interactionType: "scene",
        repoPath: "/tmp/repo-a",
        beadIds: ["foo-2", "foo-3"],
      },
      {
        kind: "prompt",
        ts: "2026-02-20T11:00:01.000Z",
        sessionId: "term-b",
        prompt: "ID: foo-2\nTitle: Second beat\n\nID: foo-3\nTitle: Third beat",
        source: "initial",
      },
      {
        kind: "session_end",
        ts: "2026-02-20T11:10:00.000Z",
        sessionId: "term-b",
        status: "completed",
        exitCode: 0,
      },
    ]);

    // Direct sessions are intentionally out-of-scope and should not appear.
    await writeLog(tempDir, "repo-a/2026-02-20/orch-a.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T12:00:00.000Z",
        sessionId: "orch-a",
        interactionType: "direct",
        repoPath: "/tmp/repo-a",
        beadIds: ["foo-4"],
      },
      {
        kind: "session_end",
        ts: "2026-02-20T12:01:00.000Z",
        sessionId: "orch-a",
        status: "completed",
        exitCode: 0,
      },
    ]);

    const history = await readAgentHistory({ logRoot: tempDir });

    expect(history.beats.map((beat) => beat.beadId)).toEqual(["foo-2", "foo-3", "foo-1"]);
    expect(history.beats[0]?.sceneCount).toBe(1);
    expect(history.beats[0]?.takeCount).toBe(0);
    expect(history.beats[2]?.takeCount).toBe(1);
    expect(history.beats[2]?.title).toBe("First beat");
  });

  it("returns selected beat sessions with prompt source metadata", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/term-c.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T13:00:00.000Z",
        sessionId: "term-c",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beadIds: ["foo-1"],
      },
      {
        kind: "prompt",
        ts: "2026-02-20T13:00:01.000Z",
        sessionId: "term-c",
        prompt: "Initial prompt",
        source: "initial",
      },
      {
        kind: "response",
        ts: "2026-02-20T13:00:02.000Z",
        sessionId: "term-c",
        raw: "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"working\"}]}}",
      },
      {
        kind: "prompt",
        ts: "2026-02-20T13:00:03.000Z",
        sessionId: "term-c",
        prompt: "Follow-up prompt",
        source: "ship_completion_follow_up",
      },
      {
        kind: "session_end",
        ts: "2026-02-20T13:00:04.000Z",
        sessionId: "term-c",
        status: "completed",
        exitCode: 0,
      },
    ]);

    const history = await readAgentHistory({
      logRoot: tempDir,
      beadId: "foo-1",
      beadRepoPath: "/tmp/repo-a",
    });

    expect(history.sessions).toHaveLength(1);
    const session = history.sessions[0];
    expect(session?.sessionId).toBe("term-c");
    expect(session?.entries.map((entry) => entry.kind)).toEqual([
      "session_start",
      "prompt",
      "response",
      "prompt",
      "session_end",
    ]);
    expect(session?.entries[1]?.promptSource).toBe("initial");
    expect(session?.entries[3]?.promptSource).toBe("ship_completion_follow_up");
  });

  it("filters by repo path when provided", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/term-a.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T14:00:00.000Z",
        sessionId: "term-a",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beadIds: ["foo-1"],
      },
    ]);

    await writeLog(tempDir, "repo-b/2026-02-20/term-b.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T14:01:00.000Z",
        sessionId: "term-b",
        interactionType: "take",
        repoPath: "/tmp/repo-b",
        beadIds: ["bar-1"],
      },
    ]);

    const history = await readAgentHistory({
      logRoot: tempDir,
      repoPath: "/tmp/repo-b",
    });

    expect(history.beats.map((beat) => beat.beadId)).toEqual(["bar-1"]);
  });

  it("filters beat summaries by sinceHours when requested", async () => {
    const now = Date.now();
    const recentTs = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const staleTs = new Date(now - 40 * 60 * 60 * 1000).toISOString();

    await writeLog(tempDir, "repo-a/2026-02-20/term-recent.jsonl", [
      {
        kind: "session_start",
        ts: recentTs,
        sessionId: "term-recent",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beadIds: ["foo-recent"],
      },
    ]);

    await writeLog(tempDir, "repo-a/2026-02-20/term-stale.jsonl", [
      {
        kind: "session_start",
        ts: staleTs,
        sessionId: "term-stale",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beadIds: ["foo-stale"],
      },
    ]);

    const history = await readAgentHistory({
      logRoot: tempDir,
      sinceHours: 24,
    });

    expect(history.beats.map((beat) => beat.beadId)).toEqual(["foo-recent"]);
  });
});
