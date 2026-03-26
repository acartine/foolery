/**
 * Agent history tests: beat summaries, filtering, and basic session
 * retrieval.
 */
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

function setupTempDir(): void {
  beforeEach(async () => {
    tempDir = await mkdtemp(
      join(tmpdir(), "agent-history-test-"),
    );
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
}

describe("summaries: sorting and repo filtering", () => {
  setupTempDir();

  it("returns beat summaries sorted by most recent", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/term-a.jsonl", [
      {
        kind: "session_start", ts: "2026-02-20T10:00:00.000Z",
        sessionId: "term-a", interactionType: "take",
        repoPath: "/tmp/repo-a", beatIds: ["foo-1"],
      },
      {
        kind: "prompt", ts: "2026-02-20T10:00:01.000Z",
        sessionId: "term-a",
        prompt: "ID: foo-1\nTitle: First beat",
        source: "initial",
      },
      {
        kind: "session_end", ts: "2026-02-20T10:03:00.000Z",
        sessionId: "term-a", status: "completed", exitCode: 0,
      },
    ]);

    await writeLog(tempDir, "repo-a/2026-02-20/term-b.jsonl", [
      {
        kind: "session_start", ts: "2026-02-20T11:00:00.000Z",
        sessionId: "term-b", interactionType: "scene",
        repoPath: "/tmp/repo-a", beatIds: ["foo-2", "foo-3"],
      },
      {
        kind: "prompt", ts: "2026-02-20T11:00:01.000Z",
        sessionId: "term-b",
        prompt:
          "ID: foo-2\nTitle: Second beat\n\nID: foo-3\nTitle: Third beat",
        source: "initial",
      },
      {
        kind: "session_end", ts: "2026-02-20T11:10:00.000Z",
        sessionId: "term-b", status: "completed", exitCode: 0,
      },
    ]);

    await writeLog(tempDir, "repo-a/2026-02-20/orch-a.jsonl", [
      {
        kind: "session_start", ts: "2026-02-20T12:00:00.000Z",
        sessionId: "orch-a", interactionType: "direct",
        repoPath: "/tmp/repo-a", beatIds: ["foo-4"],
      },
      {
        kind: "session_end", ts: "2026-02-20T12:01:00.000Z",
        sessionId: "orch-a", status: "completed", exitCode: 0,
      },
    ]);

    const history = await readAgentHistory({ logRoot: tempDir });

    expect(history.beats.map((b) => b.beatId)).toEqual(
      ["foo-4", "foo-2", "foo-3", "foo-1"],
    );
    expect(history.beats[0]?.directCount).toBe(1);
    expect(history.beats[0]?.takeCount).toBe(0);
    expect(history.beats[1]?.sceneCount).toBe(1);
    expect(history.beats[1]?.takeCount).toBe(0);
    expect(history.beats[3]?.takeCount).toBe(1);
    expect(history.beats[3]?.title).toBe("First beat");
  });

});

describe("summaries: repo path and time filtering", () => {
  setupTempDir();

  it("filters by repo path when provided", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/term-a.jsonl", [
      {
        kind: "session_start", ts: "2026-02-20T14:00:00.000Z",
        sessionId: "term-a", interactionType: "take",
        repoPath: "/tmp/repo-a", beatIds: ["foo-1"],
      },
    ]);

    await writeLog(tempDir, "repo-b/2026-02-20/term-b.jsonl", [
      {
        kind: "session_start", ts: "2026-02-20T14:01:00.000Z",
        sessionId: "term-b", interactionType: "take",
        repoPath: "/tmp/repo-b", beatIds: ["bar-1"],
      },
    ]);

    const history = await readAgentHistory({
      logRoot: tempDir, repoPath: "/tmp/repo-b",
    });
    expect(history.beats.map((b) => b.beatId)).toEqual(["bar-1"]);
  });

  it("filters by sinceHours when requested", async () => {
    const now = Date.now();
    const recentTs = new Date(
      now - 2 * 60 * 60 * 1000,
    ).toISOString();
    const staleTs = new Date(
      now - 40 * 60 * 60 * 1000,
    ).toISOString();

    await writeLog(
      tempDir, "repo-a/2026-02-20/term-recent.jsonl",
      [
        {
          kind: "session_start", ts: recentTs,
          sessionId: "term-recent", interactionType: "take",
          repoPath: "/tmp/repo-a", beatIds: ["foo-recent"],
        },
      ],
    );

    await writeLog(
      tempDir, "repo-a/2026-02-20/term-stale.jsonl",
      [
        {
          kind: "session_start", ts: staleTs,
          sessionId: "term-stale", interactionType: "take",
          repoPath: "/tmp/repo-a", beatIds: ["foo-stale"],
        },
      ],
    );

    const history = await readAgentHistory({
      logRoot: tempDir, sinceHours: 24,
    });
    expect(history.beats.map((b) => b.beatId)).toEqual([
      "foo-recent",
    ]);
  });
});

describe("summaries: interaction types and status", () => {
  setupTempDir();

  it("includes breakdown sessions in beat summaries", async () => {
    await writeLog(
      tempDir, "repo-a/2026-02-20/breakdown-a.jsonl",
      [
        {
          kind: "session_start", ts: "2026-02-20T15:00:00.000Z",
          sessionId: "breakdown-a", interactionType: "breakdown",
          repoPath: "/tmp/repo-a", beatIds: ["foo-bd"],
        },
        {
          kind: "prompt", ts: "2026-02-20T15:00:01.000Z",
          sessionId: "breakdown-a",
          prompt: "ID: foo-bd\nTitle: Breakdown beat",
          source: "initial",
        },
        {
          kind: "session_end", ts: "2026-02-20T15:02:00.000Z",
          sessionId: "breakdown-a", status: "completed",
          exitCode: 0,
        },
      ],
    );

    const history = await readAgentHistory({ logRoot: tempDir });
    expect(history.beats).toHaveLength(1);
    expect(history.beats[0]?.beatId).toBe("foo-bd");
    expect(history.beats[0]?.breakdownCount).toBe(1);
    expect(history.beats[0]?.takeCount).toBe(0);
    expect(history.beats[0]?.sessionCount).toBe(1);
    expect(history.beats[0]?.title).toBe("Breakdown beat");
  });

  it("parses sessions with beatIds field name", async () => {
    await writeLog(
      tempDir, "repo-a/2026-02-20/logger-format.jsonl",
      [
        {
          kind: "session_start", ts: "2026-02-20T16:00:00.000Z",
          sessionId: "logger-fmt", interactionType: "take",
          repoPath: "/tmp/repo-a", beatIds: ["foo-logger"],
        },
        {
          kind: "prompt", ts: "2026-02-20T16:00:01.000Z",
          sessionId: "logger-fmt",
          prompt: "ID: foo-logger\nTitle: Logger format beat",
          source: "initial",
        },
        {
          kind: "session_end", ts: "2026-02-20T16:01:00.000Z",
          sessionId: "logger-fmt", status: "completed",
          exitCode: 0,
        },
      ],
    );

    const history = await readAgentHistory({ logRoot: tempDir });
    expect(history.beats).toHaveLength(1);
    expect(history.beats[0]?.beatId).toBe("foo-logger");
    expect(history.beats[0]?.title).toBe("Logger format beat");
    expect(history.beats[0]?.takeCount).toBe(1);
  });

  it("does not filter out beats with closed status", async () => {
    await writeLog(
      tempDir, "repo-a/2026-02-20/closed-status.jsonl",
      [
        {
          kind: "session_start", ts: "2026-02-20T15:30:00.000Z",
          sessionId: "closed-status", interactionType: "take",
          repoPath: "/tmp/repo-a", beatIds: ["foo-closed"],
        },
        {
          kind: "session_end", ts: "2026-02-20T15:31:00.000Z",
          sessionId: "closed-status", status: "closed",
          exitCode: 0,
        },
      ],
    );

    await writeLog(
      tempDir, "repo-a/2026-02-20/recent-status.jsonl",
      [
        {
          kind: "session_start", ts: "2026-02-20T15:40:00.000Z",
          sessionId: "recent-status", interactionType: "take",
          repoPath: "/tmp/repo-a", beatIds: ["foo-recent"],
        },
        {
          kind: "session_end", ts: "2026-02-20T15:41:00.000Z",
          sessionId: "recent-status", status: "completed",
          exitCode: 0,
        },
      ],
    );

    const history = await readAgentHistory({ logRoot: tempDir });
    expect(history.beats.map((b) => b.beatId)).toEqual(
      ["foo-recent", "foo-closed"],
    );
  });
});
