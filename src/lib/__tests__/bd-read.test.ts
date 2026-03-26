/**
 * bd.ts tests: read operations (listBeats, readyBeats, searchBeats,
 * queryBeats, showBeat).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockExecResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

const execCalls: string[][] = [];
const execQueue: MockExecResult[] = [];

const execFileMock = vi.fn(
  (
    _file: string,
    args: string[],
    _options: unknown,
    callback: (
      error: Error | null, stdout: string, stderr: string,
    ) => void,
  ) => {
    execCalls.push(args);
    const next = execQueue.shift() ?? {
      exitCode: 0, stdout: "", stderr: "",
    };
    const code = next.exitCode ?? 0;
    const error = code === 0
      ? null
      : Object.assign(new Error(next.stderr || "mock exec failure"), {
        code,
      });
    callback(error, next.stdout ?? "", next.stderr ?? "");
  },
);

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

function queueExec(...responses: MockExecResult[]): void {
  execQueue.push(...responses);
}

const BEAT_JSON = {
  id: "proj-abc",
  title: "Test beat",
  issue_type: "task",
  status: "open",
  priority: 2,
  labels: ["foo"],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

function beatArrayStr(
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify([{ ...BEAT_JSON, ...overrides }]);
}

function beatJsonStr(
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({ ...BEAT_JSON, ...overrides });
}

describe("listBeats", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns parsed beats on success", async () => {
    queueExec({ stdout: beatArrayStr() });
    const { listBeats } = await import("@/lib/bd");
    const result = await listBeats();
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].id).toBe("proj-abc");
    expect(result.data![0].type).toBe("task");
  });

  it("passes --all when no status filter provided", async () => {
    queueExec({ stdout: "[]" });
    const { listBeats } = await import("@/lib/bd");
    await listBeats();
    expect(execCalls[0]).toContain("--all");
  });

  it("does not pass --all when status filter is provided", async () => {
    queueExec({ stdout: "[]" });
    const { listBeats } = await import("@/lib/bd");
    await listBeats({ status: "open" });
    expect(execCalls[0]).not.toContain("--all");
    expect(execCalls[0]).toContain("--status");
    expect(execCalls[0]).toContain("open");
  });

  it("returns error on non-zero exit code", async () => {
    queueExec({ stderr: "bd not found", exitCode: 1 });
    const { listBeats } = await import("@/lib/bd");
    const result = await listBeats();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("bd not found");
  });

  it("returns parse error on invalid JSON", async () => {
    queueExec({ stdout: "not json" });
    const { listBeats } = await import("@/lib/bd");
    const result = await listBeats();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Failed to parse bd list output");
  });

  it("passes filter key/value pairs as CLI args", async () => {
    queueExec({ stdout: "[]" });
    const { listBeats } = await import("@/lib/bd");
    await listBeats({ type: "bug", status: "open" });
    expect(execCalls[0]).toContain("--type");
    expect(execCalls[0]).toContain("bug");
  });
});

describe("readyBeats", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns parsed beats on success", async () => {
    queueExec({ stdout: beatArrayStr() });
    const { readyBeats } = await import("@/lib/bd");
    const result = await readyBeats();
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it("returns error on failure", async () => {
    queueExec({ stderr: "fail", exitCode: 1 });
    const { readyBeats } = await import("@/lib/bd");
    const result = await readyBeats();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("fail");
  });

  it("returns parse error on invalid JSON", async () => {
    queueExec({ stdout: "{bad" });
    const { readyBeats } = await import("@/lib/bd");
    const result = await readyBeats();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Failed to parse bd ready output");
  });

  it("passes filters as CLI args", async () => {
    queueExec({ stdout: "[]" });
    const { readyBeats } = await import("@/lib/bd");
    await readyBeats({ type: "bug" });
    expect(execCalls[0]).toContain("--type");
    expect(execCalls[0]).toContain("bug");
  });
});

describe("searchBeats", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns parsed beats on success", async () => {
    queueExec({ stdout: beatArrayStr() });
    const { searchBeats } = await import("@/lib/bd");
    const result = await searchBeats("test query");
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it("includes the search query in args", async () => {
    queueExec({ stdout: "[]" });
    const { searchBeats } = await import("@/lib/bd");
    await searchBeats("my search");
    expect(execCalls[0]).toContain("my search");
    expect(execCalls[0][0]).toBe("search");
  });

  it("maps priority filter to --priority-min/--priority-max", async () => {
    queueExec({ stdout: "[]" });
    const { searchBeats } = await import("@/lib/bd");
    await searchBeats("q", { priority: "1" });
    expect(execCalls[0]).toContain("--priority-min");
    expect(execCalls[0]).toContain("--priority-max");
  });

  it("returns error on failure", async () => {
    queueExec({ stderr: "search failed", exitCode: 1 });
    const { searchBeats } = await import("@/lib/bd");
    const result = await searchBeats("q");
    expect(result.ok).toBe(false);
  });

  it("returns parse error on invalid JSON", async () => {
    queueExec({ stdout: "bad" });
    const { searchBeats } = await import("@/lib/bd");
    const result = await searchBeats("q");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Failed to parse bd search output");
  });
});

describe("queryBeats", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns parsed beats on success", async () => {
    queueExec({ stdout: beatArrayStr() });
    const { queryBeats } = await import("@/lib/bd");
    const result = await queryBeats("status=open");
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it("passes limit and sort options", async () => {
    queueExec({ stdout: "[]" });
    const { queryBeats } = await import("@/lib/bd");
    await queryBeats("status=open", { limit: 10, sort: "priority" });
    expect(execCalls[0]).toContain("--limit");
    expect(execCalls[0]).toContain("10");
    expect(execCalls[0]).toContain("--sort");
    expect(execCalls[0]).toContain("priority");
  });

  it("returns error on failure", async () => {
    queueExec({ stderr: "query fail", exitCode: 1 });
    const { queryBeats } = await import("@/lib/bd");
    const result = await queryBeats("bad");
    expect(result.ok).toBe(false);
  });

  it("returns parse error on invalid JSON", async () => {
    queueExec({ stdout: "nope" });
    const { queryBeats } = await import("@/lib/bd");
    const result = await queryBeats("x");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Failed to parse bd query output");
  });
});

describe("showBeat", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns a single beat on success (object response)", async () => {
    queueExec({ stdout: beatJsonStr() });
    const { showBeat } = await import("@/lib/bd");
    const result = await showBeat("proj-abc");
    expect(result.ok).toBe(true);
    expect(result.data!.id).toBe("proj-abc");
  });

  it("handles array response from bd show", async () => {
    queueExec({ stdout: beatArrayStr() });
    const { showBeat } = await import("@/lib/bd");
    const result = await showBeat("proj-abc");
    expect(result.ok).toBe(true);
    expect(result.data!.id).toBe("proj-abc");
  });

  it("returns error on failure", async () => {
    queueExec({ stderr: "not found", exitCode: 1 });
    const { showBeat } = await import("@/lib/bd");
    const result = await showBeat("missing-id");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not found");
  });

  it("returns parse error on invalid JSON", async () => {
    queueExec({ stdout: "bad json" });
    const { showBeat } = await import("@/lib/bd");
    const result = await showBeat("proj-abc");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Failed to parse bd show output");
  });
});
