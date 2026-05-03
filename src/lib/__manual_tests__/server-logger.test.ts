import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock interaction-logger to control the log root path
let mockLogRoot = "";
vi.mock("@/lib/interaction-logger", () => ({
  resolveInteractionLogRoot: () => mockLogRoot,
}));

import { serverLog, logApiError, logCliFailure } from "@/lib/server-logger";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "server-logger-test-"));
  mockLogRoot = tempDir;
  vi.clearAllMocks();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/** Small delay to let fire-and-forget writes settle. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 80));
}

/** Read all JSONL lines from the server log file for today. */
async function readLogLines(): Promise<Record<string, unknown>[]> {
  await settle();
  const date = new Date().toISOString().slice(0, 10);
  const filePath = join(tempDir, "_server", date, "server.jsonl");
  const content = await readFile(filePath, "utf-8");
  return content
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// serverLog
// ---------------------------------------------------------------------------

describe("serverLog", () => {
  it("writes JSONL to _server/{date}/server.jsonl", async () => {
    serverLog("info", "test", "hello world");
    await settle();

    const date = new Date().toISOString().slice(0, 10);
    const serverDir = join(tempDir, "_server", date);
    const files = await readdir(serverDir);
    expect(files).toContain("server.jsonl");
  });

  it("produces valid JSONL with required fields", async () => {
    serverLog("warn", "test", "a warning");
    const lines = await readLogLines();

    expect(lines).toHaveLength(1);
    const entry = lines[0];
    expect(entry.ts).toBeDefined();
    expect(entry.level).toBe("warn");
    expect(entry.category).toBe("test");
    expect(entry.message).toBe("a warning");
  });

  it("includes data when provided", async () => {
    serverLog("error", "api", "request failed", { status: 500, path: "/api/test" });
    const lines = await readLogLines();

    const entry = lines[0];
    expect(entry.data).toEqual({ status: 500, path: "/api/test" });
  });

  it("omits data key when not provided", async () => {
    serverLog("info", "test", "no data");
    const lines = await readLogLines();

    expect(lines[0]).not.toHaveProperty("data");
  });

  it("serialises multiple writes sequentially", async () => {
    serverLog("info", "test", "first");
    serverLog("info", "test", "second");
    serverLog("info", "test", "third");
    const lines = await readLogLines();

    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.message)).toEqual(["first", "second", "third"]);
  });
});

// ---------------------------------------------------------------------------
// logApiError
// ---------------------------------------------------------------------------

describe("logApiError", () => {
  it("writes an error entry with api category", async () => {
    logApiError({ method: "POST", path: "/api/beats", status: 400, error: "Validation failed" });
    const lines = await readLogLines();

    const entry = lines[0];
    expect(entry.level).toBe("error");
    expect(entry.category).toBe("api");
    expect(entry.message).toBe("POST /api/beats → 400");
    expect(entry.data).toEqual({
      method: "POST",
      path: "/api/beats",
      status: 400,
      error: "Validation failed",
    });
  });

  it("handles undefined error gracefully", async () => {
    logApiError({ method: "GET", path: "/api/beats/1", status: 500, error: undefined });
    const lines = await readLogLines();

    expect((lines[0].data as Record<string, unknown>).error).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// logCliFailure
// ---------------------------------------------------------------------------

describe("logCliFailure", () => {
  it("writes an error entry with cli category", async () => {
    logCliFailure({
      command: "kno",
      args: ["--repo-root", "/tmp", "--db", "/tmp/db", "new", "--", "title"],
      exitCode: 1,
      stderr: "database is locked",
    });
    const lines = await readLogLines();

    const entry = lines[0];
    expect(entry.level).toBe("error");
    expect(entry.category).toBe("cli");
    expect(entry.message).toContain("kno");
    expect(entry.message).toContain("exited 1");
    expect((entry.data as Record<string, unknown>).exitCode).toBe(1);
    expect((entry.data as Record<string, unknown>).stderr).toBe("database is locked");
  });
});

// ---------------------------------------------------------------------------
// Fire-and-forget safety
// ---------------------------------------------------------------------------

describe("fire-and-forget safety", () => {
  it("never throws even if the log root is invalid", () => {
    mockLogRoot = "/nonexistent/path/that/should/fail";
    // Should not throw — errors are swallowed
    expect(() => serverLog("error", "test", "should not throw")).not.toThrow();
  });
});
