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

  it("returns beat summaries for all conversation types sorted by most recent activity", async () => {
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

    // Planning sessions should now appear in history.
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

    expect(history.beats.map((beat) => beat.beadId)).toEqual(["foo-4", "foo-2", "foo-3", "foo-1"]);
    expect(history.beats[0]?.directCount).toBe(1);
    expect(history.beats[0]?.takeCount).toBe(0);
    expect(history.beats[1]?.sceneCount).toBe(1);
    expect(history.beats[1]?.takeCount).toBe(0);
    expect(history.beats[3]?.takeCount).toBe(1);
    expect(history.beats[3]?.title).toBe("First beat");
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
    expect(session?.entries[1]?.promptNumber).toBe(1);
    expect(session?.entries[3]?.promptNumber).toBe(2);
  });

  it("captures workflow states from beat_state entries for selected sessions", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/term-workflow.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T13:20:00.000Z",
        sessionId: "term-workflow",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beadIds: ["foo-1"],
      },
      {
        kind: "beat_state",
        ts: "2026-02-20T13:20:00.100Z",
        sessionId: "term-workflow",
        beatId: "foo-1",
        state: "planning",
        phase: "before_prompt",
        iteration: 1,
      },
      {
        kind: "prompt",
        ts: "2026-02-20T13:20:01.000Z",
        sessionId: "term-workflow",
        prompt: "Prompt",
        source: "initial",
      },
      {
        kind: "beat_state",
        ts: "2026-02-20T13:20:02.000Z",
        sessionId: "term-workflow",
        beatId: "foo-1",
        state: "ready_for_plan_review",
        phase: "after_prompt",
        iteration: 1,
      },
      {
        kind: "session_end",
        ts: "2026-02-20T13:20:03.000Z",
        sessionId: "term-workflow",
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
    expect(history.sessions[0]?.workflowStates).toEqual([
      "planning",
      "ready_for_plan_review",
    ]);
    const promptEntry = history.sessions[0]?.entries.find((entry) => entry.kind === "prompt");
    expect(promptEntry?.promptNumber).toBe(1);
    expect(promptEntry?.workflowState).toBe("planning");
  });

  it("annotates each prompt with prompt number and workflow state from beat_state transitions", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/term-workflow-multi.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T13:25:00.000Z",
        sessionId: "term-workflow-multi",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beadIds: ["foo-1"],
      },
      {
        kind: "beat_state",
        ts: "2026-02-20T13:25:00.100Z",
        sessionId: "term-workflow-multi",
        beatId: "foo-1",
        state: "planning",
        phase: "before_prompt",
        iteration: 1,
      },
      {
        kind: "prompt",
        ts: "2026-02-20T13:25:01.000Z",
        sessionId: "term-workflow-multi",
        prompt: "Prompt 1",
        source: "initial",
      },
      {
        kind: "beat_state",
        ts: "2026-02-20T13:25:01.500Z",
        sessionId: "term-workflow-multi",
        beatId: "foo-1",
        state: "ready_for_plan_review",
        phase: "after_prompt",
        iteration: 1,
      },
      {
        kind: "beat_state",
        ts: "2026-02-20T13:25:02.100Z",
        sessionId: "term-workflow-multi",
        beatId: "foo-1",
        state: "plan_review",
        phase: "before_prompt",
        iteration: 2,
      },
      {
        kind: "prompt",
        ts: "2026-02-20T13:25:03.000Z",
        sessionId: "term-workflow-multi",
        prompt: "Prompt 2",
        source: "take_2",
      },
      {
        kind: "session_end",
        ts: "2026-02-20T13:25:04.000Z",
        sessionId: "term-workflow-multi",
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
    const prompts = history.sessions[0]?.entries.filter((entry) => entry.kind === "prompt");
    expect(prompts?.map((entry) => entry.promptNumber)).toEqual([1, 2]);
    expect(prompts?.map((entry) => entry.workflowState)).toEqual([
      "planning",
      "plan_review",
    ]);
  });

  it("includes verification sessions and prompt metadata for selected beats", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/verify-a.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T13:10:00.000Z",
        sessionId: "verify-a",
        interactionType: "verification",
        repoPath: "/tmp/repo-a",
        beadIds: ["foo-1"],
      },
      {
        kind: "prompt",
        ts: "2026-02-20T13:10:01.000Z",
        sessionId: "verify-a",
        prompt: "Verifier prompt",
        source: "verification_review",
      },
      {
        kind: "response",
        ts: "2026-02-20T13:10:02.000Z",
        sessionId: "verify-a",
        raw: "{\"type\":\"result\",\"result\":\"VERIFICATION_RESULT:pass\"}",
      },
      {
        kind: "session_end",
        ts: "2026-02-20T13:10:03.000Z",
        sessionId: "verify-a",
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
    expect(session?.interactionType).toBe("verification");
    expect(session?.entries[1]?.promptSource).toBe("verification_review");
    expect(history.beats[0]?.takeCount).toBe(0);
    expect(history.beats[0]?.sceneCount).toBe(0);
    expect(history.beats[0]?.sessionCount).toBe(1);
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

  it("treats worktree paths as the same repo when filtering by repoPath", async () => {
    const repoPath = "/tmp/foolery";

    await writeLog(tempDir, "repo-a/2026-02-20/root.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T14:00:00.000Z",
        sessionId: "root-session",
        interactionType: "take",
        repoPath,
        beadIds: ["root-beat"],
      },
    ]);

    await writeLog(tempDir, "repo-a/2026-02-20/worktree.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T14:02:00.000Z",
        sessionId: "worktree-session",
        interactionType: "take",
        repoPath: "/tmp/foolery/.claude/worktrees/agent-abc123",
        beadIds: ["worktree-beat"],
      },
      {
        kind: "prompt",
        ts: "2026-02-20T14:02:01.000Z",
        sessionId: "worktree-session",
        prompt: "ID: worktree-beat\nTitle: Worktree beat",
        source: "initial",
      },
      {
        kind: "session_end",
        ts: "2026-02-20T14:02:02.000Z",
        sessionId: "worktree-session",
        status: "completed",
        exitCode: 0,
      },
    ]);

    await writeLog(tempDir, "repo-a/2026-02-20/sibling-worktree.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T14:03:00.000Z",
        sessionId: "sibling-session",
        interactionType: "take",
        repoPath: "/tmp/foolery-wt-feature-1",
        beadIds: ["sibling-beat"],
      },
    ]);

    const history = await readAgentHistory({
      logRoot: tempDir,
      repoPath,
    });

    expect(history.beats.map((beat) => beat.beadId)).toEqual([
      "sibling-beat",
      "worktree-beat",
      "root-beat",
    ]);
    expect(history.beats.every((beat) => beat.repoPath === repoPath)).toBe(true);

    const sessionHistory = await readAgentHistory({
      logRoot: tempDir,
      repoPath,
      beadId: "worktree-beat",
      beadRepoPath: repoPath,
    });
    expect(sessionHistory.sessions).toHaveLength(1);
    expect(sessionHistory.sessions[0]?.sessionId).toBe("worktree-session");
    expect(sessionHistory.sessions[0]?.repoPath).toBe(repoPath);
    expect(sessionHistory.sessions[0]?.entries.map((entry) => entry.kind)).toEqual([
      "session_start",
      "prompt",
      "session_end",
    ]);
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

  it("includes breakdown sessions in beat summaries", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/breakdown-a.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T15:00:00.000Z",
        sessionId: "breakdown-a",
        interactionType: "breakdown",
        repoPath: "/tmp/repo-a",
        beadIds: ["foo-bd"],
      },
      {
        kind: "prompt",
        ts: "2026-02-20T15:00:01.000Z",
        sessionId: "breakdown-a",
        prompt: "ID: foo-bd\nTitle: Breakdown beat",
        source: "initial",
      },
      {
        kind: "session_end",
        ts: "2026-02-20T15:02:00.000Z",
        sessionId: "breakdown-a",
        status: "completed",
        exitCode: 0,
      },
    ]);

    const history = await readAgentHistory({ logRoot: tempDir });

    expect(history.beats).toHaveLength(1);
    expect(history.beats[0]?.beadId).toBe("foo-bd");
    expect(history.beats[0]?.breakdownCount).toBe(1);
    expect(history.beats[0]?.takeCount).toBe(0);
    expect(history.beats[0]?.sessionCount).toBe(1);
    expect(history.beats[0]?.title).toBe("Breakdown beat");
  });

  it("parses sessions when log uses beatIds field name (logger output format)", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/logger-format.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T16:00:00.000Z",
        sessionId: "logger-fmt",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beatIds: ["foo-logger"], // Note: beatIds, not beadIds - matches actual logger output
      },
      {
        kind: "prompt",
        ts: "2026-02-20T16:00:01.000Z",
        sessionId: "logger-fmt",
        prompt: "ID: foo-logger\nTitle: Logger format beat",
        source: "initial",
      },
      {
        kind: "session_end",
        ts: "2026-02-20T16:01:00.000Z",
        sessionId: "logger-fmt",
        status: "completed",
        exitCode: 0,
      },
    ]);

    const history = await readAgentHistory({ logRoot: tempDir });

    expect(history.beats).toHaveLength(1);
    expect(history.beats[0]?.beadId).toBe("foo-logger");
    expect(history.beats[0]?.title).toBe("Logger format beat");
    expect(history.beats[0]?.takeCount).toBe(1);
  });

  it("does not filter out beats when session status is closed", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/closed-status.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T15:30:00.000Z",
        sessionId: "closed-status",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beadIds: ["foo-closed"],
      },
      {
        kind: "session_end",
        ts: "2026-02-20T15:31:00.000Z",
        sessionId: "closed-status",
        status: "closed",
        exitCode: 0,
      },
    ]);

    await writeLog(tempDir, "repo-a/2026-02-20/recent-status.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T15:40:00.000Z",
        sessionId: "recent-status",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beadIds: ["foo-recent"],
      },
      {
        kind: "session_end",
        ts: "2026-02-20T15:41:00.000Z",
        sessionId: "recent-status",
        status: "completed",
        exitCode: 0,
      },
    ]);

    const history = await readAgentHistory({ logRoot: tempDir });

    expect(history.beats.map((beat) => beat.beadId)).toEqual(["foo-recent", "foo-closed"]);
  });

  it("returns sessions when queried with beadId matching beatIds in logs", async () => {
    await writeLog(tempDir, "repo-a/2026-02-20/session-query.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T17:00:00.000Z",
        sessionId: "session-query",
        interactionType: "take",
        repoPath: "/tmp/repo-a",
        beatIds: ["foo-query"],
      },
      {
        kind: "prompt",
        ts: "2026-02-20T17:00:01.000Z",
        sessionId: "session-query",
        prompt: "Do the work",
        source: "initial",
      },
      {
        kind: "session_end",
        ts: "2026-02-20T17:01:00.000Z",
        sessionId: "session-query",
        status: "completed",
        exitCode: 0,
      },
    ]);

    const history = await readAgentHistory({
      logRoot: tempDir,
      beadId: "foo-query",
      beadRepoPath: "/tmp/repo-a",
    });

    expect(history.sessions).toHaveLength(1);
    expect(history.sessions[0]?.sessionId).toBe("session-query");
    expect(history.sessions[0]?.entries).toHaveLength(3);
  });
});
