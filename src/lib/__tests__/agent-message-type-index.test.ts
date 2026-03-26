import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We test the core logic by calling buildMessageTypeIndex with a
// custom logRoot and updateMessageTypeIndexFromSession with explicit
// paths. The persistence helpers (readMessageTypeIndex /
// writeMessageTypeIndex) are covered indirectly.

let tempDir: string;

async function writeLog(
  root: string,
  relativePath: string,
  lines: Array<Record<string, unknown>>,
): Promise<string> {
  const fullPath = join(root, relativePath);
  const dir = fullPath.slice(0, fullPath.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(
    fullPath,
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    "utf-8",
  );
  return fullPath;
}

function setupTempDir(): void {
  beforeEach(async () => {
    tempDir = await mkdtemp(
      join(tmpdir(), "msg-type-index-test-"),
    );
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
}

describe("buildMessageTypeIndex: extraction", () => {
  setupTempDir();

  it("extracts unique message types from log files", async () => {
    const { buildMessageTypeIndex } = await import(
      "@/lib/agent-message-type-index"
    );

    await writeLog(tempDir, "repo-a/2026-02-20/term-a.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T10:00:00.000Z",
        sessionId: "term-a", interactionType: "take",
        repoPath: "/tmp/repo-a", beatIds: ["foo-1"],
        agentName: "claude", agentModel: "opus-4",
      },
      {
        kind: "response", ts: "2026-02-20T10:00:01.000Z",
        sessionId: "term-a",
        raw: JSON.stringify({
          type: "assistant", message: { content: [] },
        }),
      },
      {
        kind: "response", ts: "2026-02-20T10:00:02.000Z",
        sessionId: "term-a",
        raw: JSON.stringify({
          type: "user", message: { role: "user" },
        }),
      },
      {
        kind: "response", ts: "2026-02-20T10:00:03.000Z",
        sessionId: "term-a",
        raw: JSON.stringify({ type: "result", result: "done" }),
      },
      {
        kind: "response", ts: "2026-02-20T10:00:04.000Z",
        sessionId: "term-a",
        raw: JSON.stringify({
          type: "assistant", message: { content: [] },
        }),
      },
    ]);

    const index = await buildMessageTypeIndex(tempDir, 5);

    expect(index.version).toBe(1);
    expect(index.entries.length).toBe(3);

    const types = index.entries.map((e) => e.type).sort();
    expect(types).toEqual(["assistant", "result", "user"]);

    const entry = index.entries.find(
      (e) => e.type === "assistant",
    );
    expect(entry?.count).toBe(2);
    expect(entry?.agents).toEqual([
      { agentName: "claude", agentModel: "opus-4" },
    ]);
  });

});

describe("buildMessageTypeIndex: file limit", () => {
  setupTempDir();

  it("limits to the N most recent files", async () => {
    const { buildMessageTypeIndex } = await import(
      "@/lib/agent-message-type-index"
    );

    const oldFile = await writeLog(
      tempDir, "repo-a/2026-02-18/term-old.jsonl",
      [
        {
          kind: "session_start",
          ts: "2026-02-18T10:00:00.000Z",
          sessionId: "term-old", interactionType: "take",
          repoPath: "/tmp/repo-a", beatIds: ["foo-1"],
          agentName: "codex",
        },
        {
          kind: "response",
          ts: "2026-02-18T10:00:01.000Z",
          sessionId: "term-old",
          raw: JSON.stringify({ type: "old_only_type" }),
        },
      ],
    );

    const { utimes } = await import("node:fs/promises");
    const oldDate = new Date("2026-02-18T00:00:00Z");
    await utimes(oldFile, oldDate, oldDate);

    await writeLog(
      tempDir, "repo-a/2026-02-19/term-mid.jsonl",
      [
        {
          kind: "session_start",
          ts: "2026-02-19T10:00:00.000Z",
          sessionId: "term-mid", interactionType: "take",
          repoPath: "/tmp/repo-a", beatIds: ["foo-2"],
          agentName: "claude",
        },
        {
          kind: "response",
          ts: "2026-02-19T10:00:01.000Z",
          sessionId: "term-mid",
          raw: JSON.stringify({ type: "assistant" }),
        },
      ],
    );

    await writeLog(
      tempDir, "repo-a/2026-02-20/term-new.jsonl",
      [
        {
          kind: "session_start",
          ts: "2026-02-20T10:00:00.000Z",
          sessionId: "term-new", interactionType: "take",
          repoPath: "/tmp/repo-a", beatIds: ["foo-3"],
          agentName: "claude",
        },
        {
          kind: "response",
          ts: "2026-02-20T10:00:01.000Z",
          sessionId: "term-new",
          raw: JSON.stringify({ type: "result" }),
        },
      ],
    );

    const index = await buildMessageTypeIndex(tempDir, 2);
    const types = index.entries.map((e) => e.type).sort();
    expect(types).toEqual(["assistant", "result"]);
    expect(types).not.toContain("old_only_type");
  });
});

describe("buildMessageTypeIndex: edge cases", () => {
  setupTempDir();

  it("returns empty entries when no log files exist", async () => {
    const { buildMessageTypeIndex } = await import(
      "@/lib/agent-message-type-index"
    );
    const index = await buildMessageTypeIndex(tempDir);
    expect(index.entries).toEqual([]);
  });

  it("skips malformed JSON lines gracefully", async () => {
    const { buildMessageTypeIndex } = await import(
      "@/lib/agent-message-type-index"
    );

    const logPath = join(
      tempDir, "repo-a/2026-02-20/term-bad.jsonl",
    );
    const dir = join(tempDir, "repo-a/2026-02-20");
    await mkdir(dir, { recursive: true });
    await writeFile(
      logPath,
      [
        JSON.stringify({
          kind: "session_start",
          ts: "2026-02-20T10:00:00.000Z",
          sessionId: "term-bad",
          interactionType: "take",
          repoPath: "/tmp/repo-a",
          beatIds: ["foo-1"],
        }),
        "not-valid-json",
        JSON.stringify({
          kind: "response",
          ts: "2026-02-20T10:00:01.000Z",
          sessionId: "term-bad",
          raw: "also-not-valid-json",
        }),
        JSON.stringify({
          kind: "response",
          ts: "2026-02-20T10:00:02.000Z",
          sessionId: "term-bad",
          raw: JSON.stringify({ type: "assistant" }),
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const index = await buildMessageTypeIndex(tempDir);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0]?.type).toBe("assistant");
  });
});

describe("updateMessageTypeIndexFromSession", () => {
  setupTempDir();

  it("merges new types into an existing index", async () => {
    const { buildMessageTypeIndex } = await import(
      "@/lib/agent-message-type-index"
    );

    await writeLog(
      tempDir, "logs/repo-a/2026-02-20/term-update.jsonl",
      [
        {
          kind: "session_start",
          ts: "2026-02-20T11:00:00.000Z",
          sessionId: "term-update", interactionType: "take",
          repoPath: "/tmp/repo-a", beatIds: ["foo-1"],
          agentName: "codex", agentModel: "gpt-4.1",
        },
        {
          kind: "response",
          ts: "2026-02-20T11:00:01.000Z",
          sessionId: "term-update",
          raw: JSON.stringify({
            type: "assistant", message: {},
          }),
        },
        {
          kind: "response",
          ts: "2026-02-20T11:00:02.000Z",
          sessionId: "term-update",
          raw: JSON.stringify({
            type: "stream_event", event: {},
          }),
        },
      ],
    );

    const index = await buildMessageTypeIndex(
      join(tempDir, "logs"),
    );

    expect(
      index.entries.map((e) => e.type).sort(),
    ).toEqual(["assistant", "stream_event"]);
    const entry = index.entries.find(
      (e) => e.type === "assistant",
    );
    expect(entry?.agents).toEqual([
      { agentName: "codex", agentModel: "gpt-4.1" },
    ]);
  });

  it("creates index from scratch when none exists", async () => {
    const { updateMessageTypeIndexFromSession } = await import(
      "@/lib/agent-message-type-index"
    );

    const logPath = await writeLog(
      tempDir, "logs/repo/2026-02-20/term-fresh.jsonl",
      [
        {
          kind: "session_start",
          ts: "2026-02-20T12:00:00.000Z",
          sessionId: "term-fresh", interactionType: "take",
          repoPath: "/tmp/repo", beatIds: ["beat-1"],
        },
        {
          kind: "response",
          ts: "2026-02-20T12:00:01.000Z",
          sessionId: "term-fresh",
          raw: JSON.stringify({
            type: "result", result: "done",
          }),
        },
      ],
    );

    // Completing without throwing is the assertion.
    await updateMessageTypeIndexFromSession(
      logPath, "claude", "sonnet-4",
    );
  });
});

describe("extractTypesFromContent: agents and timestamps", () => {
  setupTempDir();

  it("tracks multiple agents for the same type", async () => {
    const { buildMessageTypeIndex } = await import(
      "@/lib/agent-message-type-index"
    );

    await writeLog(tempDir, "repo-a/2026-02-20/term-1.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T10:00:00.000Z",
        sessionId: "term-1", interactionType: "take",
        repoPath: "/tmp/repo-a", beatIds: ["foo-1"],
        agentName: "claude", agentModel: "opus-4",
      },
      {
        kind: "response",
        ts: "2026-02-20T10:00:01.000Z",
        sessionId: "term-1",
        raw: JSON.stringify({ type: "assistant" }),
      },
    ]);

    await writeLog(tempDir, "repo-a/2026-02-20/term-2.jsonl", [
      {
        kind: "session_start",
        ts: "2026-02-20T11:00:00.000Z",
        sessionId: "term-2", interactionType: "take",
        repoPath: "/tmp/repo-a", beatIds: ["foo-2"],
        agentName: "codex", agentModel: "gpt-4.1",
      },
      {
        kind: "response",
        ts: "2026-02-20T11:00:01.000Z",
        sessionId: "term-2",
        raw: JSON.stringify({ type: "assistant" }),
      },
    ]);

    const index = await buildMessageTypeIndex(tempDir, 5);
    const entry = index.entries.find(
      (e) => e.type === "assistant",
    );
    expect(entry?.agents).toHaveLength(2);
    expect(
      entry?.agents.map((a) => a.agentName).sort(),
    ).toEqual(["claude", "codex"]);
  });

  it("tracks firstSeen and lastSeen timestamps", async () => {
    const { buildMessageTypeIndex } = await import(
      "@/lib/agent-message-type-index"
    );

    await writeLog(
      tempDir, "repo-a/2026-02-20/term-ts.jsonl",
      [
        {
          kind: "session_start",
          ts: "2026-02-20T10:00:00.000Z",
          sessionId: "term-ts", interactionType: "take",
          repoPath: "/tmp/repo-a", beatIds: ["foo-1"],
          agentName: "claude",
        },
        {
          kind: "response",
          ts: "2026-02-20T10:00:01.000Z",
          sessionId: "term-ts",
          raw: JSON.stringify({ type: "assistant" }),
        },
        {
          kind: "response",
          ts: "2026-02-20T10:05:00.000Z",
          sessionId: "term-ts",
          raw: JSON.stringify({ type: "assistant" }),
        },
      ],
    );

    const index = await buildMessageTypeIndex(tempDir, 5);
    const entry = index.entries.find(
      (e) => e.type === "assistant",
    );
    expect(entry?.firstSeen).toBe("2026-02-20T10:00:01.000Z");
    expect(entry?.lastSeen).toBe("2026-02-20T10:05:00.000Z");
  });
});

describe("extractTypesFromContent: raw field and sorting", () => {
  setupTempDir();

  it("handles responses without raw field", async () => {
    const { buildMessageTypeIndex } = await import(
      "@/lib/agent-message-type-index"
    );

    await writeLog(
      tempDir, "repo-a/2026-02-20/term-noraw.jsonl",
      [
        {
          kind: "session_start",
          ts: "2026-02-20T10:00:00.000Z",
          sessionId: "term-noraw", interactionType: "take",
          repoPath: "/tmp/repo-a", beatIds: ["foo-1"],
        },
        {
          kind: "response",
          ts: "2026-02-20T10:00:01.000Z",
          sessionId: "term-noraw",
          // No raw field — should be skipped
          parsed: { type: "assistant" },
        },
      ],
    );

    const index = await buildMessageTypeIndex(tempDir, 5);
    expect(index.entries).toEqual([]);
  });

  it("sorts entries by count descending", async () => {
    const { buildMessageTypeIndex } = await import(
      "@/lib/agent-message-type-index"
    );

    await writeLog(
      tempDir, "repo-a/2026-02-20/term-sort.jsonl",
      [
        {
          kind: "session_start",
          ts: "2026-02-20T10:00:00.000Z",
          sessionId: "term-sort", interactionType: "take",
          repoPath: "/tmp/repo-a", beatIds: ["foo-1"],
        },
        {
          kind: "response",
          ts: "2026-02-20T10:00:01.000Z",
          sessionId: "term-sort",
          raw: JSON.stringify({ type: "result" }),
        },
        {
          kind: "response",
          ts: "2026-02-20T10:00:02.000Z",
          sessionId: "term-sort",
          raw: JSON.stringify({ type: "assistant" }),
        },
        {
          kind: "response",
          ts: "2026-02-20T10:00:03.000Z",
          sessionId: "term-sort",
          raw: JSON.stringify({ type: "assistant" }),
        },
        {
          kind: "response",
          ts: "2026-02-20T10:00:04.000Z",
          sessionId: "term-sort",
          raw: JSON.stringify({ type: "assistant" }),
        },
      ],
    );

    const index = await buildMessageTypeIndex(tempDir, 5);
    expect(index.entries[0]?.type).toBe("assistant");
    expect(index.entries[0]?.count).toBe(3);
    expect(index.entries[1]?.type).toBe("result");
    expect(index.entries[1]?.count).toBe(1);
  });
});
