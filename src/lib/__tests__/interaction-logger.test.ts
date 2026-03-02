import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock cleanupLogs so it never touches the real filesystem
const mockCleanupLogs = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/log-lifecycle", () => ({
  cleanupLogs: (...args: unknown[]) => mockCleanupLogs(...args),
}));

import {
  resolveInteractionLogRoot,
  startInteractionLog,
  noopInteractionLog,
} from "@/lib/interaction-logger";

/** Set NODE_ENV without triggering TS2540 (read-only in Next.js types). */
function setNodeEnv(value: string): void {
  (process.env as Record<string, string>).NODE_ENV = value;
}

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "interaction-logger-test-"));
  vi.clearAllMocks();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// resolveInteractionLogRoot
// ---------------------------------------------------------------------------

describe("resolveInteractionLogRoot", () => {
  const origEnv = process.env.NODE_ENV;

  afterEach(() => {
    setNodeEnv(origEnv!);
  });

  it("returns .foolery-logs under cwd in development", () => {
    setNodeEnv("development");
    const root = resolveInteractionLogRoot();
    expect(root).toContain(".foolery-logs");
    expect(root).toBe(join(process.cwd(), ".foolery-logs"));
  });

  it("returns ~/.config/foolery/logs in production", () => {
    setNodeEnv("production");
    const root = resolveInteractionLogRoot();
    expect(root).toContain(join(".config", "foolery", "logs"));
  });

  it("returns production path when NODE_ENV is test", () => {
    setNodeEnv("test");
    const root = resolveInteractionLogRoot();
    expect(root).toContain(join(".config", "foolery", "logs"));
  });
});

// ---------------------------------------------------------------------------
// noopInteractionLog
// ---------------------------------------------------------------------------

describe("noopInteractionLog", () => {
  it("returns a log with empty filePath", () => {
    const log = noopInteractionLog();
    expect(log.filePath).toBe("");
  });

  it("methods are callable without effect", () => {
    const log = noopInteractionLog();
    expect(() => log.logPrompt("hello")).not.toThrow();
    expect(() => log.logResponse('{"ok":true}')).not.toThrow();
    expect(() => log.logEnd(0, "done")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// startInteractionLog
// ---------------------------------------------------------------------------

describe("startInteractionLog", () => {
  function baseMeta() {
    return {
      sessionId: "test-session-001",
      interactionType: "take" as const,
      repoPath: "/tmp/my-repo",
      beatIds: ["beat-1", "beat-2"],
    };
  }

  /**
   * Helper: create a log whose root lands inside tempDir by temporarily
   * switching NODE_ENV to "development" and chdir-ing to tempDir.
   */
  async function startLogInTemp(meta?: Partial<ReturnType<typeof baseMeta>> & { agentName?: string; agentModel?: string }) {
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

  it("creates a log file with session_start entry", async () => {
    const log = await startLogInTemp();
    expect(log.filePath).toContain("test-session-001.jsonl");

    const content = await readFile(log.filePath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    expect(entry.kind).toBe("session_start");
    expect(entry.sessionId).toBe("test-session-001");
    expect(entry.interactionType).toBe("take");
    expect(entry.repoPath).toBe("/tmp/my-repo");
    expect(entry.beatIds).toEqual(["beat-1", "beat-2"]);
    expect(entry.ts).toBeDefined();
  });

  it("includes agentName and agentModel when provided", async () => {
    const log = await startLogInTemp({ sessionId: "agent-meta-no-agent" });
    const content1 = await readFile(log.filePath, "utf-8");
    const entry1 = JSON.parse(content1.trim());
    expect(entry1.agentName).toBeUndefined();
    expect(entry1.agentModel).toBeUndefined();

    const log2 = await startLogInTemp({
      sessionId: "agent-meta-with-agent",
      agentName: "claude",
      agentModel: "opus-4",
    });
    const content2 = await readFile(log2.filePath, "utf-8");
    const entry2 = JSON.parse(content2.trim());
    expect(entry2.agentName).toBe("claude");
    expect(entry2.agentModel).toBe("opus-4");
  });

  it("creates directory structure: .foolery-logs/<slug>/<date>/", async () => {
    await startLogInTemp();
    const logRoot = join(tempDir, ".foolery-logs");
    const slugs = await readdir(logRoot);
    expect(slugs).toContain("my-repo");

    const dates = await readdir(join(logRoot, "my-repo"));
    expect(dates).toHaveLength(1);
    expect(dates[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("sanitises repo path basename for filesystem safety", async () => {
    await startLogInTemp({ repoPath: "/home/user/my repo!@#" });
    const logRoot = join(tempDir, ".foolery-logs");
    const slugs = await readdir(logRoot);
    expect(slugs[0]).toMatch(/^[a-zA-Z0-9._-]+$/);
  });
});

// ---------------------------------------------------------------------------
// logPrompt / logResponse / logEnd
// ---------------------------------------------------------------------------

describe("InteractionLog methods", () => {
  function baseMeta() {
    return {
      sessionId: "methods-session",
      interactionType: "scene" as const,
      repoPath: "/tmp/test-repo",
      beatIds: ["b-1"],
    };
  }

  async function startLogInTemp() {
    const origCwd = process.cwd();
    const origEnv = process.env.NODE_ENV;
    setNodeEnv("development");
    process.chdir(tempDir);
    try {
      return await startInteractionLog(baseMeta());
    } finally {
      process.chdir(origCwd);
      setNodeEnv(origEnv!);
    }
  }

  /** Read all JSONL lines from a log file. */
  async function readLogLines(filePath: string) {
    // Small delay to let fire-and-forget writes settle
    await new Promise((r) => setTimeout(r, 50));
    const content = await readFile(filePath, "utf-8");
    return content
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
  }

  it("logPrompt writes a prompt entry", async () => {
    const log = await startLogInTemp();
    log.logPrompt("Summarise the codebase");
    const lines = await readLogLines(log.filePath);

    const promptLine = lines.find(
      (l: Record<string, unknown>) => l.kind === "prompt",
    );
    expect(promptLine).toBeDefined();
    expect(promptLine.prompt).toBe("Summarise the codebase");
    expect(promptLine.sessionId).toBe("methods-session");
  });

  it("logPrompt includes source metadata when provided", async () => {
    const log = await startLogInTemp();
    log.logPrompt("Do something", { source: "user-input" });
    const lines = await readLogLines(log.filePath);

    const promptLine = lines.find(
      (l: Record<string, unknown>) => l.kind === "prompt",
    );
    expect(promptLine.source).toBe("user-input");
  });

  it("logPrompt omits source when metadata.source is absent", async () => {
    const log = await startLogInTemp();
    log.logPrompt("Do something", {});
    const lines = await readLogLines(log.filePath);

    const promptLine = lines.find(
      (l: Record<string, unknown>) => l.kind === "prompt",
    );
    expect(promptLine.source).toBeUndefined();
  });

  it("logResponse writes a response entry with parsed JSON", async () => {
    const log = await startLogInTemp();
    log.logResponse('{"result":"ok","value":42}');
    const lines = await readLogLines(log.filePath);

    const respLine = lines.find(
      (l: Record<string, unknown>) => l.kind === "response",
    );
    expect(respLine).toBeDefined();
    expect(respLine.raw).toBe('{"result":"ok","value":42}');
    expect(respLine.parsed).toEqual({ result: "ok", value: 42 });
  });

  it("logResponse handles non-JSON raw lines gracefully", async () => {
    const log = await startLogInTemp();
    log.logResponse("this is not json");
    const lines = await readLogLines(log.filePath);

    const respLine = lines.find(
      (l: Record<string, unknown>) => l.kind === "response",
    );
    expect(respLine).toBeDefined();
    expect(respLine.raw).toBe("this is not json");
    expect(respLine.parsed).toBeUndefined();
  });

  it("logEnd writes a session_end entry", async () => {
    const log = await startLogInTemp();
    log.logEnd(0, "success");
    const lines = await readLogLines(log.filePath);

    const endLine = lines.find(
      (l: Record<string, unknown>) => l.kind === "session_end",
    );
    expect(endLine).toBeDefined();
    expect(endLine.exitCode).toBe(0);
    expect(endLine.status).toBe("success");
  });

  it("logEnd records null exit code", async () => {
    const log = await startLogInTemp();
    log.logEnd(null, "terminated");
    const lines = await readLogLines(log.filePath);

    const endLine = lines.find(
      (l: Record<string, unknown>) => l.kind === "session_end",
    );
    expect(endLine.exitCode).toBeNull();
    expect(endLine.status).toBe("terminated");
  });

  it("full session lifecycle writes all expected entries", async () => {
    const log = await startLogInTemp();
    log.logPrompt("prompt text", { source: "cli" });
    log.logResponse('{"msg":"hello"}');
    log.logEnd(0, "completed");

    const lines = await readLogLines(log.filePath);
    const kinds = lines.map((l: Record<string, unknown>) => l.kind);
    expect(kinds).toEqual([
      "session_start",
      "prompt",
      "response",
      "session_end",
    ]);
  });
});

// ---------------------------------------------------------------------------
// maybeScheduleCleanup (internal, tested via side effects)
//
// The cleanup throttle uses a module-level variable (lastCleanupMs) that
// persists across tests in the same module import. Earlier describe blocks
// already triggered maybeScheduleCleanup (via startInteractionLog), so
// the 1-hour throttle prevents it from firing again. We re-import the
// module with vi.resetModules() to get a fresh throttle counter.
// ---------------------------------------------------------------------------

describe("cleanup scheduling", () => {
  it("calls cleanupLogs on first startInteractionLog call", async () => {
    vi.resetModules();

    const freshCleanup = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/log-lifecycle", () => ({
      cleanupLogs: (...args: unknown[]) => freshCleanup(...args),
    }));

    const { startInteractionLog: freshStart } = await import(
      "@/lib/interaction-logger"
    );

    const origCwd = process.cwd();
    const origEnv = process.env.NODE_ENV;
    setNodeEnv("development");
    process.chdir(tempDir);
    try {
      await freshStart({
        sessionId: "cleanup-test-1",
        interactionType: "direct" as const,
        repoPath: "/tmp/repo",
        beatIds: [],
      });
    } finally {
      process.chdir(origCwd);
      setNodeEnv(origEnv!);
    }

    expect(freshCleanup).toHaveBeenCalled();
  });

  it("cleanup error does not prevent logging", async () => {
    vi.resetModules();

    const failingCleanup = vi
      .fn()
      .mockRejectedValue(new Error("cleanup failed"));
    vi.doMock("@/lib/log-lifecycle", () => ({
      cleanupLogs: (...args: unknown[]) => failingCleanup(...args),
    }));

    const { startInteractionLog: freshStart } = await import(
      "@/lib/interaction-logger"
    );

    const origCwd = process.cwd();
    const origEnv = process.env.NODE_ENV;
    setNodeEnv("development");
    process.chdir(tempDir);
    try {
      const log = await freshStart({
        sessionId: "cleanup-error-test",
        interactionType: "verification" as const,
        repoPath: "/tmp/repo",
        beatIds: [],
      });
      expect(log.filePath).toContain("cleanup-error-test.jsonl");
    } finally {
      process.chdir(origCwd);
      setNodeEnv(origEnv!);
    }
  });
});
