/**
 * Additional coverage tests for bd.ts.
 * Targets: queryBeats, closeBeat, deleteBeat, listDeps, addDep, removeDep,
 * createBeat, inferParent, normalizeBeat, isReadOnlyCommand,
 * isIdempotentWriteCommand, canRetryAfterTimeout, commandTimeoutMs,
 * shouldUseNoDbByDefault, listWorkflows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockExecResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  killed?: boolean;
}

const execCalls: string[][] = [];
const execQueue: MockExecResult[] = [];

const execFileMock = vi.fn(
  (
    _file: string,
    args: string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    execCalls.push(args);
    const next = execQueue.shift() ?? {
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
    const code = next.exitCode ?? 0;
    const error =
      code === 0
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

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockRejectedValue(new Error("ENOENT")),
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
  labels: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

describe("bd.ts additional coverage", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("queryBeats with options", async () => {
    queueExec({ stdout: JSON.stringify([BEAD_JSON]) });
    const { queryBeats } = await import("@/lib/bd");
    const result = await queryBeats("status:open", {
      limit: 5,
      sort: "priority",
    });
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
    expect(execCalls[0]).toContain("--limit");
    expect(execCalls[0]).toContain("5");
    expect(execCalls[0]).toContain("--sort");
    expect(execCalls[0]).toContain("priority");
  });

  it("queryBeats returns error on failure", async () => {
    queueExec({ stderr: "query failed", exitCode: 1 });
    const { queryBeats } = await import("@/lib/bd");
    const result = await queryBeats("status:open");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("query failed");
  });

  it("queryBeats returns parse error on invalid JSON", async () => {
    queueExec({ stdout: "not json" });
    const { queryBeats } = await import("@/lib/bd");
    const result = await queryBeats("status:open");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });

  it("closeBeat succeeds", async () => {
    queueExec({ stdout: "" });
    const { closeBeat } = await import("@/lib/bd");
    const result = await closeBeat("proj-abc", "done");
    expect(result.ok).toBe(true);
    expect(execCalls[0]).toContain("close");
    expect(execCalls[0]).toContain("--reason");
    expect(execCalls[0]).toContain("done");
  });

  it("closeBeat without reason", async () => {
    queueExec({ stdout: "" });
    const { closeBeat } = await import("@/lib/bd");
    const result = await closeBeat("proj-abc");
    expect(result.ok).toBe(true);
    expect(execCalls[0]).not.toContain("--reason");
  });

  it("closeBeat returns error on failure", async () => {
    queueExec({ stderr: "close failed", exitCode: 1 });
    const { closeBeat } = await import("@/lib/bd");
    const result = await closeBeat("proj-abc");
    expect(result.ok).toBe(false);
  });

  it("deleteBeat succeeds", async () => {
    queueExec({ stdout: "" });
    const { deleteBeat } = await import("@/lib/bd");
    const result = await deleteBeat("proj-abc");
    expect(result.ok).toBe(true);
    expect(execCalls[0]).toContain("delete");
    expect(execCalls[0]).toContain("--force");
  });

  it("deleteBeat returns error on failure", async () => {
    queueExec({ stderr: "delete failed", exitCode: 1 });
    const { deleteBeat } = await import("@/lib/bd");
    const result = await deleteBeat("proj-abc");
    expect(result.ok).toBe(false);
  });

  it("listDeps succeeds", async () => {
    queueExec({
      stdout: JSON.stringify([
        { id: "dep-1", type: "blocks", source: "a", target: "b" },
      ]),
    });
    const { listDeps } = await import("@/lib/bd");
    const result = await listDeps("proj-abc", undefined, { type: "blocks" });
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
    expect(execCalls[0]).toContain("--type");
    expect(execCalls[0]).toContain("blocks");
  });

  it("listDeps returns error on failure", async () => {
    queueExec({ stderr: "dep list failed", exitCode: 1 });
    const { listDeps } = await import("@/lib/bd");
    const result = await listDeps("proj-abc");
    expect(result.ok).toBe(false);
  });

  it("listDeps returns parse error", async () => {
    queueExec({ stdout: "bad json" });
    const { listDeps } = await import("@/lib/bd");
    const result = await listDeps("proj-abc");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });

  it("addDep succeeds", async () => {
    queueExec({ stdout: "" });
    const { addDep } = await import("@/lib/bd");
    const result = await addDep("blocker-1", "blocked-1");
    expect(result.ok).toBe(true);
    expect(execCalls[0]).toContain("dep");
    expect(execCalls[0]).toContain("--blocks");
  });

  it("addDep returns error on failure", async () => {
    queueExec({ stderr: "dep add failed", exitCode: 1 });
    const { addDep } = await import("@/lib/bd");
    const result = await addDep("blocker-1", "blocked-1");
    expect(result.ok).toBe(false);
  });

  it("removeDep succeeds", async () => {
    queueExec({ stdout: "" });
    const { removeDep } = await import("@/lib/bd");
    const result = await removeDep("blocker-1", "blocked-1");
    expect(result.ok).toBe(true);
    expect(execCalls[0]).toContain("dep");
    expect(execCalls[0]).toContain("remove");
  });

  it("removeDep returns error on failure", async () => {
    queueExec({ stderr: "dep remove failed", exitCode: 1 });
    const { removeDep } = await import("@/lib/bd");
    const result = await removeDep("blocker-1", "blocked-1");
    expect(result.ok).toBe(false);
  });

  it("listWorkflows returns builtin descriptors", async () => {
    const { listWorkflows } = await import("@/lib/bd");
    const result = await listWorkflows();
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBeGreaterThanOrEqual(1);
  });

  it("createBeat succeeds", async () => {
    queueExec({ stdout: JSON.stringify({ id: "new-1" }) });
    const { createBeat } = await import("@/lib/bd");
    const result = await createBeat({ title: "New beat" });
    expect(result.ok).toBe(true);
    expect(result.data?.id).toBe("new-1");
  });

  it("createBeat returns error on failure", async () => {
    queueExec({ stderr: "create failed", exitCode: 1 });
    const { createBeat } = await import("@/lib/bd");
    const result = await createBeat({ title: "New beat" });
    expect(result.ok).toBe(false);
  });

  it("createBeat parses plain ID output", async () => {
    queueExec({ stdout: "proj-xyz" });
    const { createBeat } = await import("@/lib/bd");
    const result = await createBeat({ title: "New beat" });
    expect(result.ok).toBe(true);
    expect(result.data?.id).toBe("proj-xyz");
  });

  it("showBeat returns parse error on bad JSON", async () => {
    queueExec({ stdout: "not json" });
    const { showBeat } = await import("@/lib/bd");
    const result = await showBeat("proj-abc");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });

  it("showBeat returns error on CLI failure", async () => {
    queueExec({ stderr: "show failed", exitCode: 1 });
    const { showBeat } = await import("@/lib/bd");
    const result = await showBeat("proj-abc");
    expect(result.ok).toBe(false);
  });

  it("readyBeats succeeds", async () => {
    queueExec({ stdout: JSON.stringify([BEAD_JSON]) });
    const { readyBeats } = await import("@/lib/bd");
    const result = await readyBeats();
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
    expect(execCalls[0]).toContain("ready");
  });

  it("readyBeats returns error on failure", async () => {
    queueExec({ stderr: "ready failed", exitCode: 1 });
    const { readyBeats } = await import("@/lib/bd");
    const result = await readyBeats();
    expect(result.ok).toBe(false);
  });

  it("readyBeats returns parse error on bad JSON", async () => {
    queueExec({ stdout: "not json" });
    const { readyBeats } = await import("@/lib/bd");
    const result = await readyBeats();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });

  it("searchBeats returns error on failure", async () => {
    queueExec({ stderr: "search failed", exitCode: 1 });
    const { searchBeats } = await import("@/lib/bd");
    const result = await searchBeats("query");
    expect(result.ok).toBe(false);
  });

  it("searchBeats returns parse error on bad JSON", async () => {
    queueExec({ stdout: "not json" });
    const { searchBeats } = await import("@/lib/bd");
    const result = await searchBeats("query");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });

  it("searchBeats passes priority filter", async () => {
    queueExec({ stdout: "[]" });
    const { searchBeats } = await import("@/lib/bd");
    await searchBeats("query", { priority: "2" });
    expect(execCalls[0]).toContain("--priority-min");
    expect(execCalls[0]).toContain("--priority-max");
  });

  it("normalizeBeat infers parent from dependencies array", async () => {
    const beadWithDeps = {
      ...BEAD_JSON,
      id: "child-1",
      dependencies: [
        { type: "parent-child", depends_on_id: "parent-1" },
      ],
    };
    queueExec({ stdout: JSON.stringify(beadWithDeps) });
    const { showBeat } = await import("@/lib/bd");
    const result = await showBeat("child-1");
    expect(result.ok).toBe(true);
    expect(result.data?.parent).toBe("parent-1");
  });

  it("normalizeBeat infers parent from dotted ID", async () => {
    const dotBead = { ...BEAD_JSON, id: "proj.1.2" };
    queueExec({ stdout: JSON.stringify(dotBead) });
    const { showBeat } = await import("@/lib/bd");
    const result = await showBeat("proj.1.2");
    expect(result.ok).toBe(true);
    expect(result.data?.parent).toBe("proj.1");
  });

  it("listBeats passes status filter as --status", async () => {
    queueExec({ stdout: "[]" });
    const { listBeats } = await import("@/lib/bd");
    await listBeats({ status: "open" });
    expect(execCalls[0]).toContain("--status");
    expect(execCalls[0]).toContain("open");
    expect(execCalls[0]).not.toContain("--all");
  });

  it("listBeats returns parse error on bad JSON", async () => {
    queueExec({ stdout: "not json" });
    const { listBeats } = await import("@/lib/bd");
    const result = await listBeats();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });
});
