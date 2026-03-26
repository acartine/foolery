/**
 * bd.ts tests: write operations (createBeat, deleteBeat, closeBeat,
 * listDeps, addDep, removeDep), normalizeBeat, exec auto-sync.
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

describe("createBeat", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns the id from JSON response", async () => {
    queueExec({ stdout: JSON.stringify({ id: "proj-new" }) });
    const { createBeat } = await import("@/lib/bd");
    const result = await createBeat({ title: "New beat" });
    expect(result.ok).toBe(true);
    expect(result.data!.id).toBe("proj-new");
  });

  it("falls back to raw stdout as id when JSON parse fails", async () => {
    queueExec({ stdout: "proj-fallback" });
    const { createBeat } = await import("@/lib/bd");
    const result = await createBeat({ title: "New beat" });
    expect(result.ok).toBe(true);
    expect(result.data!.id).toBe("proj-fallback");
  });

  it("returns error when empty stdout and parse fails", async () => {
    queueExec({ stdout: "" });
    const { createBeat } = await import("@/lib/bd");
    const result = await createBeat({ title: "New beat" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Failed to parse bd create output");
  });

  it("returns error on non-zero exit code", async () => {
    queueExec({ stderr: "create failed", exitCode: 1 });
    const { createBeat } = await import("@/lib/bd");
    const result = await createBeat({ title: "New beat" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("create failed");
  });

  it("handles labels array in fields", async () => {
    queueExec({ stdout: JSON.stringify({ id: "proj-lbl" }) });
    const { createBeat } = await import("@/lib/bd");
    await createBeat({ title: "T", labels: ["a", "b"] });
    expect(execCalls[0]).toContain("--labels");
    expect(execCalls[0]).toContain(
      "a,b,wf:state:ready_for_planning,wf:profile:autopilot",
    );
  });

  it("skips undefined and empty fields", async () => {
    queueExec({ stdout: JSON.stringify({ id: "proj-skip" }) });
    const { createBeat } = await import("@/lib/bd");
    await createBeat({
      title: "T", description: undefined, assignee: "",
    });
    const args = execCalls[0];
    expect(args).not.toContain("--description");
    expect(args).not.toContain("--assignee");
  });
});

describe("deleteBeat", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns ok on success", async () => {
    queueExec({ stdout: "" });
    const { deleteBeat } = await import("@/lib/bd");
    const result = await deleteBeat("proj-del");
    expect(result.ok).toBe(true);
    expect(execCalls[0]).toContain("--force");
  });

  it("returns error on failure", async () => {
    queueExec({ stderr: "delete error", exitCode: 1 });
    const { deleteBeat } = await import("@/lib/bd");
    const result = await deleteBeat("proj-del");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("delete error");
  });
});

describe("closeBeat", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns ok on success", async () => {
    queueExec({ stdout: "" });
    const { closeBeat } = await import("@/lib/bd");
    const result = await closeBeat("proj-close");
    expect(result.ok).toBe(true);
    expect(execCalls[0]).toContain("close");
  });

  it("passes reason when provided", async () => {
    queueExec({ stdout: "" });
    const { closeBeat } = await import("@/lib/bd");
    await closeBeat("proj-close", "done");
    expect(execCalls[0]).toContain("--reason");
    expect(execCalls[0]).toContain("done");
  });

  it("returns error on failure", async () => {
    queueExec({ stderr: "close error", exitCode: 1 });
    const { closeBeat } = await import("@/lib/bd");
    const result = await closeBeat("proj-close");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("close error");
  });
});

describe("listDeps", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns parsed dependencies on success", async () => {
    const deps = [{ id: "dep-1", type: "blocks" }];
    queueExec({ stdout: JSON.stringify(deps) });
    const { listDeps } = await import("@/lib/bd");
    const result = await listDeps("proj-abc");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(deps);
  });

  it("passes type filter when provided", async () => {
    queueExec({ stdout: "[]" });
    const { listDeps } = await import("@/lib/bd");
    await listDeps("proj-abc", undefined, { type: "parent-child" });
    expect(execCalls[0]).toContain("--type");
    expect(execCalls[0]).toContain("parent-child");
  });

  it("returns error on failure", async () => {
    queueExec({ stderr: "dep list fail", exitCode: 1 });
    const { listDeps } = await import("@/lib/bd");
    const result = await listDeps("proj-abc");
    expect(result.ok).toBe(false);
  });

  it("returns parse error on invalid JSON", async () => {
    queueExec({ stdout: "invalid" });
    const { listDeps } = await import("@/lib/bd");
    const result = await listDeps("proj-abc");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Failed to parse bd dep list output");
  });
});

describe("addDep", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns ok on success", async () => {
    queueExec({ stdout: "" });
    const { addDep } = await import("@/lib/bd");
    const result = await addDep("blocker-1", "blocked-1");
    expect(result.ok).toBe(true);
    expect(execCalls[0]).toContain("--blocks");
  });

  it("returns error on failure", async () => {
    queueExec({ stderr: "dep add fail", exitCode: 1 });
    const { addDep } = await import("@/lib/bd");
    const result = await addDep("blocker-1", "blocked-1");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("dep add fail");
  });
});

describe("removeDep", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns ok on success", async () => {
    queueExec({ stdout: "" });
    const { removeDep } = await import("@/lib/bd");
    const result = await removeDep("blocker-1", "blocked-1");
    expect(result.ok).toBe(true);
    expect(execCalls[0]).toContain("dep");
    expect(execCalls[0]).toContain("remove");
  });

  it("returns error on failure", async () => {
    queueExec({ stderr: "dep rm fail", exitCode: 1 });
    const { removeDep } = await import("@/lib/bd");
    const result = await removeDep("blocker-1", "blocked-1");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("dep rm fail");
  });
});

describe("normalizeBeat field mapping", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("maps issue_type to type", async () => {
    queueExec({ stdout: beatArrayStr({ issue_type: "bug" }) });
    const { listBeats } = await import("@/lib/bd");
    const result = await listBeats();
    expect(result.data![0].type).toBe("bug");
  });

  it("maps created_at and updated_at", async () => {
    queueExec({
      stdout: beatArrayStr({
        created_at: "2026-01-01", updated_at: "2026-01-02",
      }),
    });
    const { listBeats } = await import("@/lib/bd");
    const result = await listBeats();
    expect(result.data![0].created).toBe("2026-01-01");
    expect(result.data![0].updated).toBe("2026-01-02");
  });

  it("maps acceptance_criteria to acceptance", async () => {
    queueExec({
      stdout: beatArrayStr({ acceptance_criteria: "must pass tests" }),
    });
    const { listBeats } = await import("@/lib/bd");
    const result = await listBeats();
    expect(result.data![0].acceptance).toBe("must pass tests");
  });

  it("maps estimated_minutes to estimate", async () => {
    queueExec({ stdout: beatArrayStr({ estimated_minutes: 60 }) });
    const { listBeats } = await import("@/lib/bd");
    const result = await listBeats();
    expect(result.data![0].estimate).toBe(60);
  });

  it("defaults state to workflow initial when status missing", async () => {
    const raw = { ...BEAT_JSON };
    delete (raw as Record<string, unknown>).status;
    queueExec({ stdout: JSON.stringify([raw]) });
    const { listBeats } = await import("@/lib/bd");
    const result = await listBeats();
    expect(result.data![0].state).toBe("ready_for_implementation");
  });

  it("maps unlabeled open beats to implementation queue", async () => {
    queueExec({
      stdout: beatArrayStr({ status: "open", labels: [] }),
    });
    const { listBeats } = await import("@/lib/bd");
    const result = await listBeats();
    expect(result.data![0].state).toBe("ready_for_implementation");
  });

  it("maps unlabeled in_progress beats to implementation", async () => {
    queueExec({
      stdout: beatArrayStr({ status: "in_progress", labels: [] }),
    });
    const { listBeats } = await import("@/lib/bd");
    const result = await listBeats();
    expect(result.data![0].state).toBe("implementation");
  });

  it("defaults type to task when missing", async () => {
    const raw = { ...BEAT_JSON };
    delete (raw as Record<string, unknown>).issue_type;
    queueExec({ stdout: JSON.stringify([raw]) });
    const { listBeats } = await import("@/lib/bd");
    const result = await listBeats();
    expect(result.data![0].type).toBe("task");
  });

  it("filters empty labels", async () => {
    queueExec({
      stdout: beatArrayStr({ labels: ["a", "", " ", "b"] }),
    });
    const { listBeats } = await import("@/lib/bd");
    const result = await listBeats();
    expect(result.data![0].labels).toEqual(["a", "b"]);
  });

  it("infers parent from dependencies array", async () => {
    queueExec({
      stdout: beatArrayStr({
        dependencies: [
          { type: "parent-child", depends_on_id: "proj-parent" },
        ],
      }),
    });
    const { listBeats } = await import("@/lib/bd");
    const result = await listBeats();
    expect(result.data![0].parent).toBe("proj-parent");
  });

  it("infers parent from dot notation id", async () => {
    queueExec({
      stdout: beatArrayStr({ id: "proj.child", dependencies: [] }),
    });
    const { listBeats } = await import("@/lib/bd");
    const result = await listBeats();
    expect(result.data![0].parent).toBe("proj");
  });
});

describe("exec auto-sync on out-of-sync error", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("auto-heals and retries on out-of-sync error", async () => {
    queueExec(
      { stderr: "Database out of sync with JSONL", exitCode: 1 },
      { stdout: "" },
      { stdout: beatArrayStr() },
    );
    const { listBeats } = await import("@/lib/bd");
    const result = await listBeats();
    expect(result.ok).toBe(true);
    expect(execCalls[1]).toContain("sync");
    expect(execCalls[1]).toContain("--import-only");
  });

  it("returns original error when non-out-of-sync failure occurs", async () => {
    queueExec({ stderr: "permission denied", exitCode: 1 });
    const { listBeats } = await import("@/lib/bd");
    const result = await listBeats();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("permission denied");
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0][0]).toBe("list");
  });

  it("returns original error when sync --import-only fails", async () => {
    queueExec(
      { stderr: "Database out of sync with JSONL", exitCode: 1 },
      { stderr: "sync import failed", exitCode: 1 },
    );
    const { listBeats } = await import("@/lib/bd");
    const result = await listBeats();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Database out of sync with JSONL");
    expect(execCalls).toHaveLength(2);
    expect(execCalls[1]).toContain("sync");
  });
});
