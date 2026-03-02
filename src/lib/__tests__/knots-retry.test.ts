import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture execFile calls so we can control responses
const execFileCallbacks: Array<{
  args: string[];
  callback: (error: Error | null, stdout: string, stderr: string) => void;
}> = [];

vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (
      _bin: string,
      args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      execFileCallbacks.push({ args, callback });
    },
  ),
}));

// Import AFTER mocking
import { nextKnot } from "../knots";

function makeExecError(stderr: string): NodeJS.ErrnoException {
  const err = new Error(stderr) as NodeJS.ErrnoException;
  err.code = 1 as unknown as string;
  return err;
}

/**
 * Resolve the latest pending execFile callback with an error.
 */
function failLatest(stderr: string): void {
  const entry = execFileCallbacks[execFileCallbacks.length - 1];
  entry.callback(makeExecError(stderr), "", stderr);
}

/**
 * Resolve the latest pending execFile callback with success.
 */
function succeedLatest(): void {
  const entry = execFileCallbacks[execFileCallbacks.length - 1];
  entry.callback(null, "", "");
}

describe("nextKnot retry with exponential backoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    execFileCallbacks.length = 0;
  });

  afterEach(() => {
    // Resolve any remaining callbacks to avoid dangling promises
    for (const entry of execFileCallbacks) {
      entry.callback(null, "", "");
    }
    execFileCallbacks.length = 0;
    vi.useRealTimers();
  });

  it("succeeds on first attempt without retrying", async () => {
    const promise = nextKnot("K-0001", "/tmp/test");

    await vi.waitFor(() => {
      expect(execFileCallbacks).toHaveLength(1);
    });
    succeedLatest();

    const result = await promise;
    expect(result.ok).toBe(true);
    // Only one exec call -- no retries
    expect(execFileCallbacks).toHaveLength(1);
  });

  it("retries on 'database is locked' and succeeds", async () => {
    const promise = nextKnot("K-0001", "/tmp/test");

    // First attempt: database locked
    await vi.waitFor(() => {
      expect(execFileCallbacks).toHaveLength(1);
    });
    failLatest("database is locked");

    // Advance past the 1s retry delay
    await vi.advanceTimersByTimeAsync(1000);

    // Second attempt should fire
    await vi.waitFor(() => {
      expect(execFileCallbacks).toHaveLength(2);
    });
    succeedLatest();

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(execFileCallbacks).toHaveLength(2);
  });

  it("does NOT retry on non-transient errors", async () => {
    const promise = nextKnot("K-0001", "/tmp/test");

    await vi.waitFor(() => {
      expect(execFileCallbacks).toHaveLength(1);
    });
    failLatest("knot not found: K-0001");

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("not found");
    // No retry -- still only 1 exec call
    expect(execFileCallbacks).toHaveLength(1);
  });

  it("returns error after exhausting all retries", async () => {
    const promise = nextKnot("K-0001", "/tmp/test");

    // Attempt 1 (initial)
    await vi.waitFor(() => {
      expect(execFileCallbacks).toHaveLength(1);
    });
    failLatest("database is locked");

    // Retry 1 after 1s delay
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(execFileCallbacks).toHaveLength(2);
    });
    failLatest("database is locked");

    // Retry 2 after 2s delay
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => {
      expect(execFileCallbacks).toHaveLength(3);
    });
    failLatest("database is locked");

    // Retry 3 after 4s delay
    await vi.advanceTimersByTimeAsync(4000);
    await vi.waitFor(() => {
      expect(execFileCallbacks).toHaveLength(4);
    });
    failLatest("database is locked");

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("database is locked");
    // 1 initial + 3 retries = 4 total
    expect(execFileCallbacks).toHaveLength(4);
  });

  it("succeeds on final retry attempt", async () => {
    const promise = nextKnot("K-0001", "/tmp/test");

    // Attempt 1 (initial) - fails
    await vi.waitFor(() => {
      expect(execFileCallbacks).toHaveLength(1);
    });
    failLatest("database is locked");

    // Retry 1 after 1s - fails
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(execFileCallbacks).toHaveLength(2);
    });
    failLatest("database is locked");

    // Retry 2 after 2s - fails
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => {
      expect(execFileCallbacks).toHaveLength(3);
    });
    failLatest("database is locked");

    // Retry 3 after 4s - succeeds
    await vi.advanceTimersByTimeAsync(4000);
    await vi.waitFor(() => {
      expect(execFileCallbacks).toHaveLength(4);
    });
    succeedLatest();

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(execFileCallbacks).toHaveLength(4);
  });

  it("stops retrying when a non-transient error occurs mid-retry", async () => {
    const promise = nextKnot("K-0001", "/tmp/test");

    // Attempt 1: locked (transient)
    await vi.waitFor(() => {
      expect(execFileCallbacks).toHaveLength(1);
    });
    failLatest("database is locked");

    // Retry 1 after 1s: invalid transition (non-transient)
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(execFileCallbacks).toHaveLength(2);
    });
    failLatest("invalid transition from planning to done");

    const result = await promise;
    expect(result.ok).toBe(false);
    // Should not have retried further
    expect(execFileCallbacks).toHaveLength(2);
  });
});
