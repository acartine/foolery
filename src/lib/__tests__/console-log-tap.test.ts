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
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    vi.restoreAllMocks();
    rmSync(TEST_LOG_ROOT, { recursive: true, force: true });
  });

  function logFilePathForDate(date: string): string {
    return join(TEST_LOG_ROOT, "_server", date, "console.log");
  }

  function logFilePath(): string {
    const date = new Date().toISOString().slice(0, 10);
    return logFilePathForDate(date);
  }

  it("creates the log file and tees console.log output", async () => {
    const { installConsoleTap, _resetConsoleTapForTests } = await import(
      "@/lib/console-log-tap"
    );

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

    _resetConsoleTapForTests();
    spy.mockRestore();
  });

  it("tees console.warn and console.error", async () => {
    const { installConsoleTap, _resetConsoleTapForTests } = await import(
      "@/lib/console-log-tap"
    );

    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    installConsoleTap();

    console.warn("warning message");
    console.error("error message");

    await new Promise((r) => setTimeout(r, 50));

    const contents = readFileSync(logFilePath(), "utf-8");
    expect(contents).toContain("[WARN] warning message");
    expect(contents).toContain("[ERROR] error message");

    _resetConsoleTapForTests();
  });

  it("is idempotent — second call is a no-op", async () => {
    const { installConsoleTap, _resetConsoleTapForTests } = await import(
      "@/lib/console-log-tap"
    );

    installConsoleTap();
    const firstLog = console.log;
    installConsoleTap();

    // console.log should not have been wrapped again.
    expect(console.log).toBe(firstLog);
    _resetConsoleTapForTests();
  });

  it("formats objects and errors in log output", async () => {
    const { installConsoleTap, _resetConsoleTapForTests } = await import(
      "@/lib/console-log-tap"
    );

    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    installConsoleTap();

    console.log("obj:", { key: "value" });
    console.log("err:", new Error("boom"));

    await new Promise((r) => setTimeout(r, 50));

    const contents = readFileSync(logFilePath(), "utf-8");
    expect(contents).toContain('"key":"value"');
    expect(contents).toContain("boom");
    _resetConsoleTapForTests();
  });

  it("rolls over to a new file when the date changes", async () => {
    const { installConsoleTap, _resetConsoleTapForTests, _setDateNow } =
      await import("@/lib/console-log-tap");

    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    // Start on day 1.
    _setDateNow(() => new Date("2026-01-01T12:00:00Z"));
    installConsoleTap();

    console.log("day-one message");
    await new Promise((r) => setTimeout(r, 50));

    const day1Path = logFilePathForDate("2026-01-01");
    expect(existsSync(day1Path)).toBe(true);
    expect(readFileSync(day1Path, "utf-8")).toContain("day-one message");

    // Advance to day 2.
    _setDateNow(() => new Date("2026-01-02T03:00:00Z"));

    console.log("day-two message");
    await new Promise((r) => setTimeout(r, 50));

    const day2Path = logFilePathForDate("2026-01-02");
    expect(existsSync(day2Path)).toBe(true);
    expect(readFileSync(day2Path, "utf-8")).toContain("day-two message");

    // Day 1 file should NOT contain day-two content.
    expect(readFileSync(day1Path, "utf-8")).not.toContain("day-two message");
    _resetConsoleTapForTests();
  });

  it("captures uncaughtException to the log file", async () => {
    const before = process.listeners("uncaughtException").length;
    const { installConsoleTap, _resetConsoleTapForTests } = await import(
      "@/lib/console-log-tap"
    );

    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    installConsoleTap();

    // Emit a synthetic uncaughtException event.
    const fakeError = new Error("synthetic crash");
    process.emit("uncaughtExceptionMonitor", fakeError);

    await new Promise((r) => setTimeout(r, 50));

    const contents = readFileSync(logFilePath(), "utf-8");
    expect(contents).toContain("[FATAL]");
    expect(contents).toContain("Uncaught exception: synthetic crash");
    expect(process.listeners("uncaughtException")).toHaveLength(before);
    _resetConsoleTapForTests();
  });

  it("captures unhandledRejection to the log file", async () => {
    const rethrow = vi.fn();
    const {
      installConsoleTap,
      _resetConsoleTapForTests,
      _setUnhandledRejectionRethrow,
    } = await import("@/lib/console-log-tap");

    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const originalListeners = process.listeners.bind(process);
    vi.spyOn(process, "listeners").mockImplementation((eventName) => {
      if (String(eventName) === "unhandledRejection") {
        return [((): void => {})];
      }
      return originalListeners(eventName);
    });

    _setUnhandledRejectionRethrow(rethrow);
    installConsoleTap();

    // Emit a synthetic unhandledRejection event.
    const fakeReason = new Error("unhandled promise");
    process.emit("unhandledRejection", fakeReason, Promise.resolve());

    await new Promise((r) => setTimeout(r, 50));

    const contents = readFileSync(logFilePath(), "utf-8");
    expect(contents).toContain("[FATAL]");
    expect(contents).toContain("Unhandled rejection: unhandled promise");
    expect(rethrow).toHaveBeenCalledWith(fakeReason);
    _resetConsoleTapForTests();
  });

  it("attaches an error handler to the write stream (no crash on error)", async () => {
    const { EventEmitter } = await import("node:events");

    // Create a fake stream that we can emit errors on.
    const fakeStream = Object.assign(new EventEmitter(), {
      write: vi.fn(() => true),
      end: vi.fn(),
      destroy: vi.fn(),
    });

    // Use vi.doMock to intercept createWriteStream for this test only.
    vi.doMock("node:fs", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("node:fs")>();
      return { ...actual, createWriteStream: () => fakeStream };
    });

    const { installConsoleTap, _resetConsoleTapForTests } = await import(
      "@/lib/console-log-tap"
    );

    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    installConsoleTap();

    // Trigger a log line so ensureStream() is called and the stream is created.
    console.log("trigger stream creation");

    // Verify an error handler is registered (listenerCount > 0).
    expect(fakeStream.listenerCount("error")).toBeGreaterThan(0);

    // Emitting an error should not throw.
    expect(() => {
      fakeStream.emit("error", new Error("ENOSPC"));
    }).not.toThrow();
    _resetConsoleTapForTests();
  });

  it("reopens a fresh stream after a stream error", async () => {
    const { EventEmitter } = await import("node:events");

    const firstStream = Object.assign(new EventEmitter(), {
      write: vi.fn(() => true),
      end: vi.fn(),
      destroy: vi.fn(),
    });
    const secondStream = Object.assign(new EventEmitter(), {
      write: vi.fn(() => true),
      end: vi.fn(),
      destroy: vi.fn(),
    });

    vi.doMock("node:fs", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        createWriteStream: vi
          .fn()
          .mockReturnValueOnce(firstStream)
          .mockReturnValueOnce(secondStream),
      };
    });

    const { installConsoleTap, _resetConsoleTapForTests } = await import(
      "@/lib/console-log-tap"
    );

    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    installConsoleTap();

    console.log("first message");
    expect(firstStream.write).toHaveBeenCalledTimes(2);

    firstStream.emit("error", new Error("ENOSPC"));
    expect(firstStream.destroy).toHaveBeenCalledTimes(1);

    console.log("second message");
    expect(secondStream.write).toHaveBeenCalledTimes(1);

    _resetConsoleTapForTests();
  });
});
