import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// Use a temp directory for log output so tests don't pollute real logs.
const TEST_LOG_ROOT = join(process.cwd(), ".foolery-logs-test-tap");

vi.mock("@/lib/interaction-logger", () => ({
  resolveInteractionLogRoot: () => TEST_LOG_ROOT,
}));

describe("console-log-tap", () => {
  let origLog: typeof console.log;
  let origWarn: typeof console.warn;
  let origError: typeof console.error;

  beforeEach(() => {
    // Save originals before each test (they may have been patched by a prior test).
    origLog = console.log;
    origWarn = console.warn;
    origError = console.error;

    // Clean up temp dir and reset module state so installConsoleTap can re-run.
    rmSync(TEST_LOG_ROOT, { recursive: true, force: true });
    vi.resetModules();
  });

  afterEach(() => {
    // Restore originals in case the tap replaced them.
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    rmSync(TEST_LOG_ROOT, { recursive: true, force: true });
  });

  function logFilePath(): string {
    const date = new Date().toISOString().slice(0, 10);
    return join(TEST_LOG_ROOT, "_server", date, "console.log");
  }

  it("creates the log file and tees console.log output", async () => {
    const { installConsoleTap } = await import("@/lib/console-log-tap");

    // Suppress actual terminal output during test.
    const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    installConsoleTap();

    console.log("hello from test");

    // Give the write stream a tick to flush.
    await new Promise((r) => setTimeout(r, 50));

    const path = logFilePath();
    expect(existsSync(path)).toBe(true);

    const contents = readFileSync(path, "utf-8");
    expect(contents).toContain("[LOG] hello from test");

    spy.mockRestore();
  });

  it("tees console.warn and console.error", async () => {
    const { installConsoleTap } = await import("@/lib/console-log-tap");

    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    installConsoleTap();

    console.warn("warning message");
    console.error("error message");

    await new Promise((r) => setTimeout(r, 50));

    const contents = readFileSync(logFilePath(), "utf-8");
    expect(contents).toContain("[WARN] warning message");
    expect(contents).toContain("[ERROR] error message");
  });

  it("is idempotent — second call is a no-op", async () => {
    const { installConsoleTap } = await import("@/lib/console-log-tap");

    installConsoleTap();
    const firstLog = console.log;
    installConsoleTap();

    // console.log should not have been wrapped again.
    expect(console.log).toBe(firstLog);
  });

  it("formats objects and errors in log output", async () => {
    const { installConsoleTap } = await import("@/lib/console-log-tap");

    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    installConsoleTap();

    console.log("obj:", { key: "value" });
    console.log("err:", new Error("boom"));

    await new Promise((r) => setTimeout(r, 50));

    const contents = readFileSync(logFilePath(), "utf-8");
    expect(contents).toContain('"key":"value"');
    expect(contents).toContain("boom");
  });
});
