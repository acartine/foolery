/**
 * Agent history tests: session detail retrieval, workflow states,
 * worktrees.
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

describe("sessions: prompt metadata and entries", () => {
  setupTempDir();

  it("returns selected beat sessions with prompt source metadata", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/term-c.jsonl", [
      {
        kind: "session_start", ts: "2026-02-20T13:00:00.000Z",
        sessionId: "term-c", interactionType: "take",
        repoPath: "/tmp/repo-a", beatIds: ["foo-1"],
      },
      {
        kind: "prompt", ts: "2026-02-20T13:00:01.000Z",
        sessionId: "term-c", prompt: "Initial prompt",
        source: "initial",
      },
      {
        kind: "response", ts: "2026-02-20T13:00:02.000Z",
        sessionId: "term-c",
        raw: '{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}',
      },
      {
        kind: "prompt", ts: "2026-02-20T13:00:03.000Z",
        sessionId: "term-c", prompt: "Follow-up prompt",
        source: "ship_completion_follow_up",
      },
      {
        kind: "session_end", ts: "2026-02-20T13:00:04.000Z",
        sessionId: "term-c", status: "completed", exitCode: 0,
      },
    ]);

    const history = await readAgentHistory({
      logRoot: tempDir,
      beatId: "foo-1",
      beatRepoPath: "/tmp/repo-a",
    });

    expect(history.sessions).toHaveLength(1);
    const session = history.sessions[0];
    expect(session?.sessionId).toBe("term-c");
    expect(session?.entries.map((e) => e.kind)).toEqual([
      "session_start", "prompt", "response",
      "prompt", "session_end",
    ]);
    expect(session?.entries[1]?.promptSource).toBe("initial");
    expect(session?.entries[3]?.promptSource).toBe(
      "ship_completion_follow_up",
    );
    expect(session?.entries[1]?.promptNumber).toBe(1);
    expect(session?.entries[3]?.promptNumber).toBe(2);
  });

  it("includes direct sessions and prompt metadata", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/direct-a.jsonl", [
      {
        kind: "session_start", ts: "2026-02-20T13:10:00.000Z",
        sessionId: "direct-a", interactionType: "take",
        repoPath: "/tmp/repo-a", beatIds: ["foo-1"],
      },
      {
        kind: "prompt", ts: "2026-02-20T13:10:01.000Z",
        sessionId: "direct-a", prompt: "Review prompt",
        source: "initial",
      },
      {
        kind: "response", ts: "2026-02-20T13:10:02.000Z",
        sessionId: "direct-a",
        raw: '{"type":"result","result":"ok"}',
      },
      {
        kind: "session_end", ts: "2026-02-20T13:10:03.000Z",
        sessionId: "direct-a", status: "completed", exitCode: 0,
      },
    ]);

    const history = await readAgentHistory({
      logRoot: tempDir,
      beatId: "foo-1",
      beatRepoPath: "/tmp/repo-a",
    });

    expect(history.sessions).toHaveLength(1);
    const session = history.sessions[0];
    expect(session?.interactionType).toBe("take");
    expect(session?.entries[1]?.promptSource).toBe("initial");
    expect(history.beats[0]?.takeCount).toBe(1);
    expect(history.beats[0]?.sceneCount).toBe(0);
    expect(history.beats[0]?.sessionCount).toBe(1);
  });
});

describe("sessions: workflow state capture", () => {
  setupTempDir();

  it("captures workflow states from beat_state entries", async () => {
    await writeLog(
      tempDir, "repo-a/2026-02-20/term-workflow.jsonl",
      [
        {
          kind: "session_start", ts: "2026-02-20T13:20:00.000Z",
          sessionId: "term-workflow", interactionType: "take",
          repoPath: "/tmp/repo-a", beatIds: ["foo-1"],
        },
        {
          kind: "beat_state", ts: "2026-02-20T13:20:00.100Z",
          sessionId: "term-workflow", beatId: "foo-1",
          state: "planning", phase: "before_prompt", iteration: 1,
        },
        {
          kind: "prompt", ts: "2026-02-20T13:20:01.000Z",
          sessionId: "term-workflow", prompt: "Prompt",
          source: "initial",
        },
        {
          kind: "beat_state", ts: "2026-02-20T13:20:02.000Z",
          sessionId: "term-workflow", beatId: "foo-1",
          state: "ready_for_plan_review",
          phase: "after_prompt", iteration: 1,
        },
        {
          kind: "session_end", ts: "2026-02-20T13:20:03.000Z",
          sessionId: "term-workflow", status: "completed",
          exitCode: 0,
        },
      ],
    );

    const history = await readAgentHistory({
      logRoot: tempDir,
      beatId: "foo-1",
      beatRepoPath: "/tmp/repo-a",
    });

    expect(history.sessions).toHaveLength(1);
    expect(history.sessions[0]?.workflowStates).toEqual([
      "planning", "ready_for_plan_review",
    ]);
    const promptEntry = history.sessions[0]?.entries.find(
      (entry) => entry.kind === "prompt",
    );
    expect(promptEntry?.promptNumber).toBe(1);
    expect(promptEntry?.workflowState).toBe("planning");
  });

});

describe("sessions: workflow state annotations", () => {
  setupTempDir();

  it("annotates prompts with number and workflow state", async () => {
    await writeLog(
      tempDir, "repo-a/2026-02-20/term-workflow-multi.jsonl",
      [
        {
          kind: "session_start", ts: "2026-02-20T13:25:00.000Z",
          sessionId: "term-workflow-multi",
          interactionType: "take",
          repoPath: "/tmp/repo-a", beatIds: ["foo-1"],
        },
        {
          kind: "beat_state", ts: "2026-02-20T13:25:00.100Z",
          sessionId: "term-workflow-multi", beatId: "foo-1",
          state: "planning", phase: "before_prompt", iteration: 1,
        },
        {
          kind: "prompt", ts: "2026-02-20T13:25:01.000Z",
          sessionId: "term-workflow-multi", prompt: "Prompt 1",
          source: "initial",
        },
        {
          kind: "beat_state", ts: "2026-02-20T13:25:01.500Z",
          sessionId: "term-workflow-multi", beatId: "foo-1",
          state: "ready_for_plan_review",
          phase: "after_prompt", iteration: 1,
        },
        {
          kind: "beat_state", ts: "2026-02-20T13:25:02.100Z",
          sessionId: "term-workflow-multi", beatId: "foo-1",
          state: "plan_review",
          phase: "before_prompt", iteration: 2,
        },
        {
          kind: "prompt", ts: "2026-02-20T13:25:03.000Z",
          sessionId: "term-workflow-multi", prompt: "Prompt 2",
          source: "take_2",
        },
        {
          kind: "session_end", ts: "2026-02-20T13:25:04.000Z",
          sessionId: "term-workflow-multi", status: "completed",
          exitCode: 0,
        },
      ],
    );

    const history = await readAgentHistory({
      logRoot: tempDir,
      beatId: "foo-1",
      beatRepoPath: "/tmp/repo-a",
    });

    expect(history.sessions).toHaveLength(1);
    const prompts = history.sessions[0]?.entries.filter(
      (entry) => entry.kind === "prompt",
    );
    expect(prompts?.map((e) => e.promptNumber)).toEqual([1, 2]);
    expect(prompts?.map((e) => e.workflowState)).toEqual([
      "planning", "plan_review",
    ]);
  });
});

describe("sessions: worktree and query filtering", () => {
  setupTempDir();

  it("treats worktree paths as the same repo", async () => {
    const repoPath = "/tmp/foolery";

    await writeLog(tempDir, "repo-a/2026-02-20/root.jsonl", [
      {
        kind: "session_start", ts: "2026-02-20T14:00:00.000Z",
        sessionId: "root-session", interactionType: "take",
        repoPath, beatIds: ["root-beat"],
      },
    ]);

    await writeLog(tempDir, "repo-a/2026-02-20/worktree.jsonl", [
      {
        kind: "session_start", ts: "2026-02-20T14:02:00.000Z",
        sessionId: "worktree-session", interactionType: "take",
        repoPath: "/tmp/foolery/.claude/worktrees/agent-abc123",
        beatIds: ["worktree-beat"],
      },
      {
        kind: "prompt", ts: "2026-02-20T14:02:01.000Z",
        sessionId: "worktree-session",
        prompt: "ID: worktree-beat\nTitle: Worktree beat",
        source: "initial",
      },
      {
        kind: "session_end", ts: "2026-02-20T14:02:02.000Z",
        sessionId: "worktree-session", status: "completed",
        exitCode: 0,
      },
    ]);

    await writeLog(
      tempDir, "repo-a/2026-02-20/sibling-worktree.jsonl",
      [
        {
          kind: "session_start", ts: "2026-02-20T14:03:00.000Z",
          sessionId: "sibling-session", interactionType: "take",
          repoPath: "/tmp/foolery-wt-feature-1",
          beatIds: ["sibling-beat"],
        },
      ],
    );

    const history = await readAgentHistory({
      logRoot: tempDir, repoPath,
    });

    expect(history.beats.map((b) => b.beatId)).toEqual([
      "sibling-beat", "worktree-beat", "root-beat",
    ]);
    expect(
      history.beats.every((b) => b.repoPath === repoPath),
    ).toBe(true);

    const sessionHistory = await readAgentHistory({
      logRoot: tempDir, repoPath,
      beatId: "worktree-beat", beatRepoPath: repoPath,
    });
    expect(sessionHistory.sessions).toHaveLength(1);
    expect(sessionHistory.sessions[0]?.sessionId).toBe(
      "worktree-session",
    );
    expect(sessionHistory.sessions[0]?.repoPath).toBe(repoPath);
    expect(
      sessionHistory.sessions[0]?.entries.map((e) => e.kind),
    ).toEqual(["session_start", "prompt", "session_end"]);
  });

  it("returns sessions when queried with beatId", async () => {
    await writeLog(
      tempDir, "repo-a/2026-02-20/session-query.jsonl",
      [
        {
          kind: "session_start", ts: "2026-02-20T17:00:00.000Z",
          sessionId: "session-query", interactionType: "take",
          repoPath: "/tmp/repo-a", beatIds: ["foo-query"],
        },
        {
          kind: "prompt", ts: "2026-02-20T17:00:01.000Z",
          sessionId: "session-query", prompt: "Do the work",
          source: "initial",
        },
        {
          kind: "session_end", ts: "2026-02-20T17:01:00.000Z",
          sessionId: "session-query", status: "completed",
          exitCode: 0,
        },
      ],
    );

    const history = await readAgentHistory({
      logRoot: tempDir,
      beatId: "foo-query",
      beatRepoPath: "/tmp/repo-a",
    });

    expect(history.sessions).toHaveLength(1);
    expect(history.sessions[0]?.sessionId).toBe("session-query");
    expect(history.sessions[0]?.entries).toHaveLength(3);
  });
});
