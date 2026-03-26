import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock cleanupLogs so it never touches the real filesystem
const mockCleanupLogs = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/log-lifecycle", () => ({
  cleanupLogs: (...args: unknown[]) => mockCleanupLogs(...args),
}));

import {
  startInteractionLog,
  noopInteractionLog,
} from "@/lib/interaction-logger";

/** Set NODE_ENV without triggering TS2540 (read-only in Next.js types). */
function setNodeEnv(value: string): void {
  (process.env as Record<string, string>).NODE_ENV = value;
}

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "agent-output-log-test-"));
  vi.clearAllMocks();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function baseMeta() {
  return {
    sessionId: "output-log-session-001",
    interactionType: "take" as const,
    repoPath: "/tmp/my-repo",
    beatIds: ["beat-1"],
  };
}

async function startLogInTemp(
  meta?: Partial<ReturnType<typeof baseMeta>>,
) {
  const origCwd = process.cwd();
  const origEnv = process.env.NODE_ENV;
  setNodeEnv("development");
  process.chdir(tempDir);
  try {
    return await startInteractionLog({ ...baseMeta(), ...meta });
  } finally {
    process.chdir(origCwd);
    setNodeEnv(origEnv!);
  }
}

/** Small delay to let fire-and-forget writes settle. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

// ---------------------------------------------------------------------------
// InteractionLog: stdoutPath / stderrPath
// ---------------------------------------------------------------------------

describe("InteractionLog stdout/stderr paths", () => {
  it("exposes stdoutPath and stderrPath based on session ID", async () => {
    const log = await startLogInTemp();
    expect(log.stdoutPath).toContain("output-log-session-001.stdout.log");
    expect(log.stderrPath).toContain("output-log-session-001.stderr.log");
  });

  it("places stdout/stderr files in the same directory as the JSONL log", async () => {
    const log = await startLogInTemp();
    const jsonlDir = log.filePath.replace(/\/[^/]+$/, "");
    const stdoutDir = log.stdoutPath.replace(/\/[^/]+$/, "");
    const stderrDir = log.stderrPath.replace(/\/[^/]+$/, "");
    expect(stdoutDir).toBe(jsonlDir);
    expect(stderrDir).toBe(jsonlDir);
  });
});

// ---------------------------------------------------------------------------
// logStdout / logStderr
// ---------------------------------------------------------------------------

describe("logStdout", () => {
  it("creates the stdout file lazily on first write", async () => {
    const log = await startLogInTemp({ sessionId: "stdout-lazy" });

    // File should NOT exist before any write
    const existsBefore = await stat(log.stdoutPath).then(
      () => true,
      () => false,
    );
    expect(existsBefore).toBe(false);

    log.logStdout("hello stdout\n");
    await settle();

    const existsAfter = await stat(log.stdoutPath).then(
      () => true,
      () => false,
    );
    expect(existsAfter).toBe(true);
  });

  it("appends multiple chunks to the stdout file", async () => {
    const log = await startLogInTemp({ sessionId: "stdout-multi" });

    log.logStdout("chunk 1\n");
    log.logStdout("chunk 2\n");
    log.logStdout("chunk 3\n");
    await settle();

    const content = await readFile(log.stdoutPath, "utf-8");
    expect(content).toBe("chunk 1\nchunk 2\nchunk 3\n");
  });

  it("preserves raw content without transformation", async () => {
    const log = await startLogInTemp({ sessionId: "stdout-raw" });
    const raw = '{"type":"result","data":"test"}\n';
    log.logStdout(raw);
    await settle();

    const content = await readFile(log.stdoutPath, "utf-8");
    expect(content).toBe(raw);
  });
});

describe("logStderr", () => {
  it("creates the stderr file lazily on first write", async () => {
    const log = await startLogInTemp({ sessionId: "stderr-lazy" });

    const existsBefore = await stat(log.stderrPath).then(
      () => true,
      () => false,
    );
    expect(existsBefore).toBe(false);

    log.logStderr("error output\n");
    await settle();

    const existsAfter = await stat(log.stderrPath).then(
      () => true,
      () => false,
    );
    expect(existsAfter).toBe(true);
  });

  it("appends multiple chunks to the stderr file", async () => {
    const log = await startLogInTemp({ sessionId: "stderr-multi" });

    log.logStderr("err 1\n");
    log.logStderr("err 2\n");
    await settle();

    const content = await readFile(log.stderrPath, "utf-8");
    expect(content).toBe("err 1\nerr 2\n");
  });
});

// ---------------------------------------------------------------------------
// noopInteractionLog
// ---------------------------------------------------------------------------

describe("noopInteractionLog stdout/stderr", () => {
  it("has empty stdoutPath and stderrPath", () => {
    const log = noopInteractionLog();
    expect(log.stdoutPath).toBe("");
    expect(log.stderrPath).toBe("");
  });

  it("logStdout and logStderr are callable without effect", () => {
    const log = noopInteractionLog();
    expect(() => log.logStdout("data")).not.toThrow();
    expect(() => log.logStderr("data")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Both stdout and stderr in a full session lifecycle
// ---------------------------------------------------------------------------

describe("full session with stdout/stderr logging", () => {
  it("captures stdout, stderr, and structured logs together", async () => {
    const log = await startLogInTemp({ sessionId: "full-lifecycle" });

    log.logPrompt("do the thing");
    log.logStdout('{"type":"stream_event"}\n');
    log.logStderr("warning: something\n");
    log.logResponse('{"type":"result"}');
    log.logStdout('{"type":"result","ok":true}\n');
    log.logStderr("trace: cleanup\n");
    log.logEnd(0, "completed");

    await settle();

    // JSONL log has structured entries
    const jsonlContent = await readFile(log.filePath, "utf-8");
    const jsonlLines = jsonlContent.trim().split("\n").map((l) => JSON.parse(l));
    const kinds = jsonlLines.map((l: Record<string, unknown>) => l.kind);
    expect(kinds).toContain("session_start");
    expect(kinds).toContain("prompt");
    expect(kinds).toContain("response");
    expect(kinds).toContain("session_end");

    // stdout log has raw output
    const stdoutContent = await readFile(log.stdoutPath, "utf-8");
    expect(stdoutContent).toContain('{"type":"stream_event"}');
    expect(stdoutContent).toContain('{"type":"result","ok":true}');

    // stderr log has raw error output
    const stderrContent = await readFile(log.stderrPath, "utf-8");
    expect(stderrContent).toContain("warning: something");
    expect(stderrContent).toContain("trace: cleanup");
  });

  it("does not create stdout/stderr files when no output occurs", async () => {
    const log = await startLogInTemp({ sessionId: "no-output" });
    log.logPrompt("prompt only");
    log.logEnd(0, "completed");
    await settle();

    // JSONL exists (from session_start)
    const jsonlExists = await stat(log.filePath).then(
      () => true,
      () => false,
    );
    expect(jsonlExists).toBe(true);

    // stdout/stderr should NOT exist
    const stdoutExists = await stat(log.stdoutPath).then(
      () => true,
      () => false,
    );
    const stderrExists = await stat(log.stderrPath).then(
      () => true,
      () => false,
    );
    expect(stdoutExists).toBe(false);
    expect(stderrExists).toBe(false);
  });
});
