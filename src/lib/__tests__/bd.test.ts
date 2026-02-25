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
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ) => {
    execCalls.push(args);
    const next = execQueue.shift() ?? { exitCode: 0, stdout: "", stderr: "" };
    const code = next.exitCode ?? 0;
    const error =
      code === 0
        ? null
        : Object.assign(new Error(next.stderr || "mock exec failure"), {
            code,
          });
    callback(error, next.stdout ?? "", next.stderr ?? "");
  }
);

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

function queueExec(...responses: MockExecResult[]): void {
  execQueue.push(...responses);
}

const BEAD_JSON = {
  id: "proj-abc",
  title: "Test bead",
  issue_type: "task",
  status: "open",
  priority: 2,
  labels: ["foo"],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

function beadJsonStr(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...BEAD_JSON, ...overrides });
}

function beadArrayStr(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify([{ ...BEAD_JSON, ...overrides }]);
}

describe("listBeads", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns parsed beads on success", async () => {
    queueExec({ stdout: beadArrayStr() });
    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads();
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].id).toBe("proj-abc");
    expect(result.data![0].type).toBe("task");
  });

  it("passes --all when no status filter provided", async () => {
    queueExec({ stdout: "[]" });
    const { listBeads } = await import("@/lib/bd");
    await listBeads();
    expect(execCalls[0]).toContain("--all");
  });

  it("does not pass --all when status filter is provided", async () => {
    queueExec({ stdout: "[]" });
    const { listBeads } = await import("@/lib/bd");
    await listBeads({ status: "open" });
    expect(execCalls[0]).not.toContain("--all");
    expect(execCalls[0]).toContain("--status");
    expect(execCalls[0]).toContain("open");
  });

  it("returns error on non-zero exit code", async () => {
    queueExec({ stderr: "bd not found", exitCode: 1 });
    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("bd not found");
  });

  it("returns parse error on invalid JSON", async () => {
    queueExec({ stdout: "not json" });
    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Failed to parse bd list output");
  });

  it("passes filter key/value pairs as CLI args", async () => {
    queueExec({ stdout: "[]" });
    const { listBeads } = await import("@/lib/bd");
    await listBeads({ type: "bug", status: "open" });
    expect(execCalls[0]).toContain("--type");
    expect(execCalls[0]).toContain("bug");
  });
});

describe("readyBeads", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns parsed beads on success", async () => {
    queueExec({ stdout: beadArrayStr() });
    const { readyBeads } = await import("@/lib/bd");
    const result = await readyBeads();
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it("returns error on failure", async () => {
    queueExec({ stderr: "fail", exitCode: 1 });
    const { readyBeads } = await import("@/lib/bd");
    const result = await readyBeads();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("fail");
  });

  it("returns parse error on invalid JSON", async () => {
    queueExec({ stdout: "{bad" });
    const { readyBeads } = await import("@/lib/bd");
    const result = await readyBeads();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Failed to parse bd ready output");
  });

  it("passes filters as CLI args", async () => {
    queueExec({ stdout: "[]" });
    const { readyBeads } = await import("@/lib/bd");
    await readyBeads({ type: "bug" });
    expect(execCalls[0]).toContain("--type");
    expect(execCalls[0]).toContain("bug");
  });
});

describe("searchBeads", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns parsed beads on success", async () => {
    queueExec({ stdout: beadArrayStr() });
    const { searchBeads } = await import("@/lib/bd");
    const result = await searchBeads("test query");
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it("includes the search query in args", async () => {
    queueExec({ stdout: "[]" });
    const { searchBeads } = await import("@/lib/bd");
    await searchBeads("my search");
    expect(execCalls[0]).toContain("my search");
    expect(execCalls[0][0]).toBe("search");
  });

  it("maps priority filter to --priority-min/--priority-max", async () => {
    queueExec({ stdout: "[]" });
    const { searchBeads } = await import("@/lib/bd");
    await searchBeads("q", { priority: "1" });
    expect(execCalls[0]).toContain("--priority-min");
    expect(execCalls[0]).toContain("--priority-max");
  });

  it("returns error on failure", async () => {
    queueExec({ stderr: "search failed", exitCode: 1 });
    const { searchBeads } = await import("@/lib/bd");
    const result = await searchBeads("q");
    expect(result.ok).toBe(false);
  });

  it("returns parse error on invalid JSON", async () => {
    queueExec({ stdout: "bad" });
    const { searchBeads } = await import("@/lib/bd");
    const result = await searchBeads("q");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Failed to parse bd search output");
  });
});

describe("queryBeads", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns parsed beads on success", async () => {
    queueExec({ stdout: beadArrayStr() });
    const { queryBeads } = await import("@/lib/bd");
    const result = await queryBeads("status=open");
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it("passes limit and sort options", async () => {
    queueExec({ stdout: "[]" });
    const { queryBeads } = await import("@/lib/bd");
    await queryBeads("status=open", { limit: 10, sort: "priority" });
    expect(execCalls[0]).toContain("--limit");
    expect(execCalls[0]).toContain("10");
    expect(execCalls[0]).toContain("--sort");
    expect(execCalls[0]).toContain("priority");
  });

  it("returns error on failure", async () => {
    queueExec({ stderr: "query fail", exitCode: 1 });
    const { queryBeads } = await import("@/lib/bd");
    const result = await queryBeads("bad");
    expect(result.ok).toBe(false);
  });

  it("returns parse error on invalid JSON", async () => {
    queueExec({ stdout: "nope" });
    const { queryBeads } = await import("@/lib/bd");
    const result = await queryBeads("x");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Failed to parse bd query output");
  });
});

describe("showBead", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns a single bead on success (object response)", async () => {
    queueExec({ stdout: beadJsonStr() });
    const { showBead } = await import("@/lib/bd");
    const result = await showBead("proj-abc");
    expect(result.ok).toBe(true);
    expect(result.data!.id).toBe("proj-abc");
  });

  it("handles array response from bd show", async () => {
    queueExec({ stdout: beadArrayStr() });
    const { showBead } = await import("@/lib/bd");
    const result = await showBead("proj-abc");
    expect(result.ok).toBe(true);
    expect(result.data!.id).toBe("proj-abc");
  });

  it("returns error on failure", async () => {
    queueExec({ stderr: "not found", exitCode: 1 });
    const { showBead } = await import("@/lib/bd");
    const result = await showBead("missing-id");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not found");
  });

  it("returns parse error on invalid JSON", async () => {
    queueExec({ stdout: "bad json" });
    const { showBead } = await import("@/lib/bd");
    const result = await showBead("proj-abc");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Failed to parse bd show output");
  });
});

describe("createBead", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns the id from JSON response", async () => {
    queueExec({ stdout: JSON.stringify({ id: "proj-new" }) });
    const { createBead } = await import("@/lib/bd");
    const result = await createBead({ title: "New bead" });
    expect(result.ok).toBe(true);
    expect(result.data!.id).toBe("proj-new");
  });

  it("falls back to raw stdout as id when JSON parse fails", async () => {
    queueExec({ stdout: "proj-fallback" });
    const { createBead } = await import("@/lib/bd");
    const result = await createBead({ title: "New bead" });
    expect(result.ok).toBe(true);
    expect(result.data!.id).toBe("proj-fallback");
  });

  it("returns error when empty stdout and parse fails", async () => {
    queueExec({ stdout: "" });
    const { createBead } = await import("@/lib/bd");
    const result = await createBead({ title: "New bead" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Failed to parse bd create output");
  });

  it("returns error on non-zero exit code", async () => {
    queueExec({ stderr: "create failed", exitCode: 1 });
    const { createBead } = await import("@/lib/bd");
    const result = await createBead({ title: "New bead" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("create failed");
  });

  it("handles labels array in fields", async () => {
    queueExec({ stdout: JSON.stringify({ id: "proj-lbl" }) });
    const { createBead } = await import("@/lib/bd");
    await createBead({ title: "T", labels: ["a", "b"] });
    expect(execCalls[0]).toContain("--labels");
    expect(execCalls[0]).toContain("a,b,wf:state:open");
  });

  it("skips undefined and empty fields", async () => {
    queueExec({ stdout: JSON.stringify({ id: "proj-skip" }) });
    const { createBead } = await import("@/lib/bd");
    await createBead({ title: "T", description: undefined, assignee: "" });
    const args = execCalls[0];
    expect(args).not.toContain("--description");
    expect(args).not.toContain("--assignee");
  });
});

describe("deleteBead", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns ok on success", async () => {
    queueExec({ stdout: "" });
    const { deleteBead } = await import("@/lib/bd");
    const result = await deleteBead("proj-del");
    expect(result.ok).toBe(true);
    expect(execCalls[0]).toContain("--force");
  });

  it("returns error on failure", async () => {
    queueExec({ stderr: "delete error", exitCode: 1 });
    const { deleteBead } = await import("@/lib/bd");
    const result = await deleteBead("proj-del");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("delete error");
  });
});

describe("closeBead", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns ok on success", async () => {
    queueExec({ stdout: "" });
    const { closeBead } = await import("@/lib/bd");
    const result = await closeBead("proj-close");
    expect(result.ok).toBe(true);
    expect(execCalls[0]).toContain("close");
  });

  it("passes reason when provided", async () => {
    queueExec({ stdout: "" });
    const { closeBead } = await import("@/lib/bd");
    await closeBead("proj-close", "done");
    expect(execCalls[0]).toContain("--reason");
    expect(execCalls[0]).toContain("done");
  });

  it("returns error on failure", async () => {
    queueExec({ stderr: "close error", exitCode: 1 });
    const { closeBead } = await import("@/lib/bd");
    const result = await closeBead("proj-close");
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

describe("normalizeBead field mapping", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("maps issue_type to type", async () => {
    queueExec({ stdout: beadArrayStr({ issue_type: "bug" }) });
    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads();
    expect(result.data![0].type).toBe("bug");
  });

  it("maps created_at and updated_at", async () => {
    queueExec({
      stdout: beadArrayStr({
        created_at: "2026-01-01",
        updated_at: "2026-01-02",
      }),
    });
    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads();
    expect(result.data![0].created).toBe("2026-01-01");
    expect(result.data![0].updated).toBe("2026-01-02");
  });

  it("maps acceptance_criteria to acceptance", async () => {
    queueExec({
      stdout: beadArrayStr({ acceptance_criteria: "must pass tests" }),
    });
    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads();
    expect(result.data![0].acceptance).toBe("must pass tests");
  });

  it("maps estimated_minutes to estimate", async () => {
    queueExec({ stdout: beadArrayStr({ estimated_minutes: 60 }) });
    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads();
    expect(result.data![0].estimate).toBe(60);
  });

  it("defaults status to open when missing", async () => {
    const raw = { ...BEAD_JSON };
    delete (raw as Record<string, unknown>).status;
    queueExec({ stdout: JSON.stringify([raw]) });
    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads();
    expect(result.data![0].status).toBe("open");
  });

  it("defaults type to task when missing", async () => {
    const raw = { ...BEAD_JSON };
    delete (raw as Record<string, unknown>).issue_type;
    queueExec({ stdout: JSON.stringify([raw]) });
    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads();
    expect(result.data![0].type).toBe("task");
  });

  it("filters empty labels", async () => {
    queueExec({ stdout: beadArrayStr({ labels: ["a", "", " ", "b"] }) });
    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads();
    expect(result.data![0].labels).toEqual(["a", "b"]);
  });

  it("infers parent from dependencies array", async () => {
    queueExec({
      stdout: beadArrayStr({
        dependencies: [
          { type: "parent-child", depends_on_id: "proj-parent" },
        ],
      }),
    });
    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads();
    expect(result.data![0].parent).toBe("proj-parent");
  });

  it("infers parent from dot notation id", async () => {
    queueExec({
      stdout: beadArrayStr({ id: "proj.child", dependencies: [] }),
    });
    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads();
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
      {
        stderr: "Database out of sync with JSONL",
        exitCode: 1,
      },
      { stdout: "" }, // sync --import-only
      { stdout: beadArrayStr() } // retry
    );
    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads();
    expect(result.ok).toBe(true);
    expect(execCalls[1]).toContain("sync");
    expect(execCalls[1]).toContain("--import-only");
  });

  it("returns original error when non-out-of-sync failure occurs", async () => {
    queueExec({ stderr: "permission denied", exitCode: 1 });
    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("permission denied");
    // Should NOT attempt sync for a non-out-of-sync error
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0][0]).toBe("list");
  });

  it("returns original error when sync --import-only fails", async () => {
    queueExec(
      { stderr: "Database out of sync with JSONL", exitCode: 1 }, // list fails
      { stderr: "sync import failed", exitCode: 1 } // sync --import-only fails
    );
    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads();
    expect(result.ok).toBe(false);
    // Should return the original list error, not the sync error
    expect(result.error).toBe("Database out of sync with JSONL");
    expect(execCalls).toHaveLength(2);
    expect(execCalls[1]).toContain("sync");
  });
});
