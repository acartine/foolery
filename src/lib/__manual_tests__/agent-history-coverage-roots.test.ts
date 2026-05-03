/**
 * Manual integration test for agent-history.ts production log root
 * discovery, worktree roots, knots worktree, and dedup.
 *
 * Writes JSONL logs to a real `mkdtemp` directory and mutates
 * `process.env.HOME` + `NODE_ENV` to steer the production log-root
 * resolver, so it lives in `__manual_tests__/` and is excluded from the
 * default suite per the project's Hermetic Test Policy.
 * Run with `bun run test:manual`.
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

type EnvRec = Record<string, string | undefined>;

function saveEnv(
  ...keys: string[]
): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) saved[k] = process.env[k];
  return saved;
}

function restoreEnv(
  saved: Record<string, string | undefined>,
): void {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete (process.env as EnvRec)[k];
    else (process.env as EnvRec)[k] = v;
  }
}

function setupTempDir(): void {
  beforeEach(async () => {
    tempDir = await mkdtemp(
      join(tmpdir(), "agent-history-cov-roots-"),
    );
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
}

describe("coverage: repo-local .foolery-logs in production", () => {
  setupTempDir();

  it("includes repo-local .foolery-logs in production mode", async () => {
    const saved = saveEnv("HOME", "NODE_ENV");
    const fakeHome = join(tempDir, "fake-home");
    const repoPath = join(tempDir, "repo-a");

    await mkdir(fakeHome, { recursive: true });
    await mkdir(repoPath, { recursive: true });

    await writeLog(
      join(repoPath, ".foolery-logs"),
      "repo-a/2026-03-03/repo-local.jsonl",
      [
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
      ],
    );

    await writeLog(
      join(fakeHome, ".config", "foolery", "logs"),
      "repo-a/2026-03-03/global.jsonl",
      [
        {
          kind: "session_start",
          ts: "2026-03-03T09:00:00.000Z",
          sessionId: "global-1",
          interactionType: "take",
          repoPath: "/different/repo",
          beatIds: ["global-beat"],
        },
      ],
    );

    (process.env as EnvRec).HOME = fakeHome;
    (process.env as EnvRec).NODE_ENV = "production";

    try {
      const history = await readAgentHistory({ repoPath });
      expect(history.beats.map((b) => b.beatId)).toEqual([
        "repo-local-beat",
      ]);
    } finally {
      restoreEnv(saved);
    }
  });
});

describe("coverage: sibling worktree .foolery-logs", () => {
  setupTempDir();

  it("includes sibling worktree .foolery-logs roots", async () => {
    const saved = saveEnv("HOME", "NODE_ENV");
    const fakeHome = join(tempDir, "fake-home");
    const repoPath = join(tempDir, "repo-worktree");
    const siblingPath = join(
      tempDir, "repo-worktree-wt-feature-1",
    );

    await mkdir(fakeHome, { recursive: true });
    await mkdir(repoPath, { recursive: true });
    await mkdir(siblingPath, { recursive: true });

    await writeLog(
      join(siblingPath, ".foolery-logs"),
      "repo-worktree/2026-03-03/worktree.jsonl",
      [
        {
          kind: "session_start",
          ts: "2026-03-03T12:00:00.000Z",
          sessionId: "sibling-worktree-1",
          interactionType: "take",
          repoPath: siblingPath,
          beatIds: ["sibling-worktree-beat"],
        },
        {
          kind: "session_end",
          ts: "2026-03-03T12:01:00.000Z",
          sessionId: "sibling-worktree-1",
          status: "completed",
          exitCode: 0,
        },
      ],
    );

    (process.env as EnvRec).HOME = fakeHome;
    (process.env as EnvRec).NODE_ENV = "production";

    try {
      const history = await readAgentHistory({ repoPath });
      expect(history.beats.map((b) => b.beatId)).toEqual([
        "sibling-worktree-beat",
      ]);
      expect(history.beats[0]?.repoPath).toBe(repoPath);
    } finally {
      restoreEnv(saved);
    }
  });
});

describe("coverage: nested .claude/worktrees roots", () => {
  setupTempDir();

  it("includes nested .claude/worktrees roots", async () => {
    const saved = saveEnv("HOME", "NODE_ENV");
    const fakeHome = join(tempDir, "fake-home");
    const repoPath = join(tempDir, "repo-nested");
    const nestedPath = join(
      repoPath, ".claude", "worktrees", "agent-abc123",
    );

    await mkdir(fakeHome, { recursive: true });
    await mkdir(nestedPath, { recursive: true });

    await writeLog(
      join(nestedPath, ".foolery-logs"),
      "repo-nested/2026-03-03/nested.jsonl",
      [
        {
          kind: "session_start",
          ts: "2026-03-03T12:30:00.000Z",
          sessionId: "nested-worktree-1",
          interactionType: "scene",
          repoPath: nestedPath,
          beatIds: ["nested-worktree-beat"],
        },
        {
          kind: "session_end",
          ts: "2026-03-03T12:31:00.000Z",
          sessionId: "nested-worktree-1",
          status: "completed",
          exitCode: 0,
        },
      ],
    );

    (process.env as EnvRec).HOME = fakeHome;
    (process.env as EnvRec).NODE_ENV = "production";

    try {
      const history = await readAgentHistory({ repoPath });
      expect(history.beats.map((b) => b.beatId)).toEqual([
        "nested-worktree-beat",
      ]);
      expect(history.beats[0]?.repoPath).toBe(repoPath);
      expect(history.beats[0]?.sceneCount).toBe(1);
    } finally {
      restoreEnv(saved);
    }
  });
});

describe("coverage: knots worktree canonical repo logs", () => {
  setupTempDir();

  it("includes canonical repo logs for .knots/_worktree", async () => {
    const saved = saveEnv("HOME", "NODE_ENV");
    const fakeHome = join(tempDir, "fake-home");
    const repoPath = join(tempDir, "repo-knots");
    const knotsPath = join(repoPath, ".knots", "_worktree");

    await mkdir(fakeHome, { recursive: true });
    await mkdir(knotsPath, { recursive: true });

    await writeLog(
      join(repoPath, ".foolery-logs"),
      "repo-knots/2026-03-03/canonical.jsonl",
      [
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
      ],
    );

    (process.env as EnvRec).HOME = fakeHome;
    (process.env as EnvRec).NODE_ENV = "production";

    try {
      const history = await readAgentHistory({
        repoPath: knotsPath,
      });
      expect(history.beats.map((b) => b.beatId)).toEqual([
        "knots-canonical-beat",
      ]);
      expect(history.beats[0]?.repoPath).toBe(knotsPath);

      const sessionHistory = await readAgentHistory({
        repoPath: knotsPath,
        beatId: "knots-canonical-beat",
        beatRepoPath: knotsPath,
      });
      expect(sessionHistory.sessions).toHaveLength(1);
      expect(sessionHistory.sessions[0]?.sessionId).toBe(
        "knots-canonical-1",
      );
      expect(sessionHistory.sessions[0]?.repoPath).toBe(
        knotsPath,
      );
    } finally {
      restoreEnv(saved);
    }
  });
});

describe("coverage: dedup sessions from both roots", () => {
  setupTempDir();

  it("deduplicates sessions from both roots", async () => {
    const saved = saveEnv("HOME", "NODE_ENV");
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

    await writeLog(
      join(repoPath, ".foolery-logs"),
      "repo-b/2026-03-03/shared.jsonl",
      sharedLines,
    );
    await writeLog(
      join(fakeHome, ".config", "foolery", "logs"),
      "repo-b/2026-03-03/shared.jsonl",
      sharedLines,
    );

    (process.env as EnvRec).HOME = fakeHome;
    (process.env as EnvRec).NODE_ENV = "production";

    try {
      const history = await readAgentHistory({ repoPath });
      const beat = history.beats.find(
        (b) => b.beatId === "shared-beat",
      );
      expect(beat?.sessionCount).toBe(1);
      expect(beat?.sceneCount).toBe(1);
    } finally {
      restoreEnv(saved);
    }
  });
});
