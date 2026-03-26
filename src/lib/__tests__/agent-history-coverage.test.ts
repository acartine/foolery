/**
 * Additional coverage tests for agent-history.ts.
 * Targets uncovered parse paths: readLogFile with .gz, empty logs,
 * session with invalid interactionType, session with empty beatIds,
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
        beatIds: ["gz-beat"],
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
    expect(history.beats.map((b) => b.beatId)).toContain("gz-beat");
  });

  it("skips sessions with invalid interactionType", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/invalid-type.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T10:00:00.000Z",
        sessionId: "invalid-type-1",
        interactionType: "unknown_type",
        repoPath: "/tmp/repo-a",
        beatIds: ["beat-1"],
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
        beatIds: ["beat-1"],
      },
    ]);

    const history = await readAgentHistory({ logRoot: tempDir });
    expect(history.beats).toHaveLength(0);
  });

  it("skips sessions with empty beatIds", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/no-beats.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T10:00:00.000Z",
        sessionId: "no-beats-1",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beatIds: [],
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
        beatIds: ["beat-nr"],
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
      beatId: "beat-nr",
      beatRepoPath: "/tmp/repo-a",
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
        beatIds: ["beat-m"],
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
    expect(history.beats.map((b) => b.beatId)).toContain("beat-m");
  });

  it("increments session counts for same beat across multiple files", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/s1.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T10:00:00.000Z",
        sessionId: "s1",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beatIds: ["shared-beat"],
      },
    ]);
    await writeLog(tempDir, "repo-a/2026-02-20/s2.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T11:00:00.000Z",
        sessionId: "s2",
        interactionType: "scene",
        repoPath: "/tmp/repo-a",
        beatIds: ["shared-beat"],
      },
    ]);

    const history = await readAgentHistory({ logRoot: tempDir });
    const beat = history.beats.find((b) => b.beatId === "shared-beat");
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

  it("extracts parent beat titles from prompt", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/parent.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T10:00:00.000Z",
        sessionId: "parent-1",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beatIds: ["parent-beat"],
      },
      {
        kind: "prompt",
        ts: "2026-02-20T10:00:01.000Z",
        sessionId: "parent-1",
        prompt: "Parent ID: parent-beat\nParent Title: The Parent Beat",
      },
    ]);

    const history = await readAgentHistory({ logRoot: tempDir });
    const beat = history.beats.find((b) => b.beatId === "parent-beat");
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
        beatIds: ["exit-beat"],
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
      beatId: "exit-beat",
      beatRepoPath: "/tmp/repo-a",
    });
    expect(history.sessions[0]?.exitCode).toBeNull();
  });

  it("includes repo-local .foolery-logs in production mode when repoPath is provided", async () => {
    const originalHome = process.env.HOME;
    const originalNodeEnv = process.env.NODE_ENV;
    const fakeHome = join(tempDir, "fake-home");
    const repoPath = join(tempDir, "repo-a");

    await mkdir(fakeHome, { recursive: true });
    await mkdir(repoPath, { recursive: true });

    await writeLog(join(repoPath, ".foolery-logs"), "repo-a/2026-03-03/repo-local.jsonl", [
      {
        kind: "session_start",
        ts: "2026-03-03T10:00:00.000Z",
        sessionId: "repo-local-1",
        interactionType: "take",
        repoPath,
        beatIds: ["repo-local-beat"],
      },
      {
        kind: "session_end",
        ts: "2026-03-03T10:01:00.000Z",
        sessionId: "repo-local-1",
        status: "completed",
        exitCode: 0,
      },
    ]);

    await writeLog(join(fakeHome, ".config", "foolery", "logs"), "repo-a/2026-03-03/global.jsonl", [
      {
        kind: "session_start",
        ts: "2026-03-03T09:00:00.000Z",
        sessionId: "global-1",
        interactionType: "take",
        repoPath: "/different/repo",
        beatIds: ["global-beat"],
      },
    ]);

    (process.env as Record<string, string | undefined>).HOME = fakeHome;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    try {
      const history = await readAgentHistory({ repoPath });
      expect(history.beats.map((b) => b.beatId)).toEqual(["repo-local-beat"]);
    } finally {
      type EnvRec = Record<string, string | undefined>;
      if (originalHome === undefined) {
        delete (process.env as EnvRec).HOME;
      } else {
        (process.env as EnvRec).HOME = originalHome;
      }
      if (originalNodeEnv === undefined) {
        delete (process.env as EnvRec).NODE_ENV;
      } else {
        (process.env as EnvRec).NODE_ENV = originalNodeEnv;
      }
    }
  });

  it("includes sibling worktree .foolery-logs roots for the active repository", async () => {
    const originalHome = process.env.HOME;
    const originalNodeEnv = process.env.NODE_ENV;
    const fakeHome = join(tempDir, "fake-home");
    const repoPath = join(tempDir, "repo-worktree");
    const siblingWorktreePath = join(tempDir, "repo-worktree-wt-feature-1");

    await mkdir(fakeHome, { recursive: true });
    await mkdir(repoPath, { recursive: true });
    await mkdir(siblingWorktreePath, { recursive: true });

    await writeLog(join(siblingWorktreePath, ".foolery-logs"), "repo-worktree/2026-03-03/worktree.jsonl", [
      {
        kind: "session_start",
        ts: "2026-03-03T12:00:00.000Z",
        sessionId: "sibling-worktree-1",
        interactionType: "take",
        repoPath: siblingWorktreePath,
        beatIds: ["sibling-worktree-beat"],
      },
      {
        kind: "session_end",
        ts: "2026-03-03T12:01:00.000Z",
        sessionId: "sibling-worktree-1",
        status: "completed",
        exitCode: 0,
      },
    ]);

    (process.env as Record<string, string | undefined>).HOME = fakeHome;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    try {
      const history = await readAgentHistory({ repoPath });
      expect(history.beats.map((b) => b.beatId)).toEqual(["sibling-worktree-beat"]);
      expect(history.beats[0]?.repoPath).toBe(repoPath);
    } finally {
      type EnvRec = Record<string, string | undefined>;
      if (originalHome === undefined) {
        delete (process.env as EnvRec).HOME;
      } else {
        (process.env as EnvRec).HOME = originalHome;
      }
      if (originalNodeEnv === undefined) {
        delete (process.env as EnvRec).NODE_ENV;
      } else {
        (process.env as EnvRec).NODE_ENV = originalNodeEnv;
      }
    }
  });

  it("includes nested .claude/worktrees .foolery-logs roots for the active repository", async () => {
    const originalHome = process.env.HOME;
    const originalNodeEnv = process.env.NODE_ENV;
    const fakeHome = join(tempDir, "fake-home");
    const repoPath = join(tempDir, "repo-nested");
    const nestedWorktreePath = join(repoPath, ".claude", "worktrees", "agent-abc123");

    await mkdir(fakeHome, { recursive: true });
    await mkdir(nestedWorktreePath, { recursive: true });

    await writeLog(join(nestedWorktreePath, ".foolery-logs"), "repo-nested/2026-03-03/nested.jsonl", [
      {
        kind: "session_start",
        ts: "2026-03-03T12:30:00.000Z",
        sessionId: "nested-worktree-1",
        interactionType: "scene",
        repoPath: nestedWorktreePath,
        beatIds: ["nested-worktree-beat"],
      },
      {
        kind: "session_end",
        ts: "2026-03-03T12:31:00.000Z",
        sessionId: "nested-worktree-1",
        status: "completed",
        exitCode: 0,
      },
    ]);

    (process.env as Record<string, string | undefined>).HOME = fakeHome;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    try {
      const history = await readAgentHistory({ repoPath });
      expect(history.beats.map((b) => b.beatId)).toEqual(["nested-worktree-beat"]);
      expect(history.beats[0]?.repoPath).toBe(repoPath);
      expect(history.beats[0]?.sceneCount).toBe(1);
    } finally {
      type EnvRec = Record<string, string | undefined>;
      if (originalHome === undefined) {
        delete (process.env as EnvRec).HOME;
      } else {
        (process.env as EnvRec).HOME = originalHome;
      }
      if (originalNodeEnv === undefined) {
        delete (process.env as EnvRec).NODE_ENV;
      } else {
        (process.env as EnvRec).NODE_ENV = originalNodeEnv;
      }
    }
  });

  it("includes canonical repo logs when active repo path is a .knots/_worktree checkout", async () => {
    const originalHome = process.env.HOME;
    const originalNodeEnv = process.env.NODE_ENV;
    const fakeHome = join(tempDir, "fake-home");
    const repoPath = join(tempDir, "repo-knots");
    const knotsWorktreePath = join(repoPath, ".knots", "_worktree");

    await mkdir(fakeHome, { recursive: true });
    await mkdir(knotsWorktreePath, { recursive: true });

    await writeLog(join(repoPath, ".foolery-logs"), "repo-knots/2026-03-03/canonical.jsonl", [
      {
        kind: "session_start",
        ts: "2026-03-03T13:00:00.000Z",
        sessionId: "knots-canonical-1",
        interactionType: "take",
        repoPath,
        beatIds: ["knots-canonical-beat"],
      },
      {
        kind: "session_end",
        ts: "2026-03-03T13:01:00.000Z",
        sessionId: "knots-canonical-1",
        status: "completed",
        exitCode: 0,
      },
    ]);

    (process.env as Record<string, string | undefined>).HOME = fakeHome;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    try {
      const history = await readAgentHistory({ repoPath: knotsWorktreePath });
      expect(history.beats.map((b) => b.beatId)).toEqual(["knots-canonical-beat"]);
      expect(history.beats[0]?.repoPath).toBe(knotsWorktreePath);

      const sessionHistory = await readAgentHistory({
        repoPath: knotsWorktreePath,
        beatId: "knots-canonical-beat",
        beatRepoPath: knotsWorktreePath,
      });
      expect(sessionHistory.sessions).toHaveLength(1);
      expect(sessionHistory.sessions[0]?.sessionId).toBe("knots-canonical-1");
      expect(sessionHistory.sessions[0]?.repoPath).toBe(knotsWorktreePath);
    } finally {
      type EnvRec = Record<string, string | undefined>;
      if (originalHome === undefined) {
        delete (process.env as EnvRec).HOME;
      } else {
        (process.env as EnvRec).HOME = originalHome;
      }
      if (originalNodeEnv === undefined) {
        delete (process.env as EnvRec).NODE_ENV;
      } else {
        (process.env as EnvRec).NODE_ENV = originalNodeEnv;
      }
    }
  });

  it("deduplicates sessions discovered in both default and repo-local roots", async () => {
    const originalHome = process.env.HOME;
    const originalNodeEnv = process.env.NODE_ENV;
    const fakeHome = join(tempDir, "fake-home");
    const repoPath = join(tempDir, "repo-b");

    await mkdir(fakeHome, { recursive: true });
    await mkdir(repoPath, { recursive: true });

    const sharedLines = [
      {
        kind: "session_start",
        ts: "2026-03-03T11:00:00.000Z",
        sessionId: "shared-session",
        interactionType: "scene",
        repoPath,
        beatIds: ["shared-beat"],
      },
      {
        kind: "session_end",
        ts: "2026-03-03T11:01:00.000Z",
        sessionId: "shared-session",
        status: "completed",
        exitCode: 0,
      },
    ];

    await writeLog(join(repoPath, ".foolery-logs"), "repo-b/2026-03-03/shared.jsonl", sharedLines);
    await writeLog(join(fakeHome, ".config", "foolery", "logs"), "repo-b/2026-03-03/shared.jsonl", sharedLines);

    (process.env as Record<string, string | undefined>).HOME = fakeHome;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    try {
      const history = await readAgentHistory({ repoPath });
      const beat = history.beats.find((b) => b.beatId === "shared-beat");
      expect(beat?.sessionCount).toBe(1);
      expect(beat?.sceneCount).toBe(1);
    } finally {
      type EnvRec = Record<string, string | undefined>;
      if (originalHome === undefined) {
        delete (process.env as EnvRec).HOME;
      } else {
        (process.env as EnvRec).HOME = originalHome;
      }
      if (originalNodeEnv === undefined) {
        delete (process.env as EnvRec).NODE_ENV;
      } else {
        (process.env as EnvRec).NODE_ENV = originalNodeEnv;
      }
    }
  });
});
