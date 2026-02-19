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

describe("searchBeads skips empty filter values (line 185)", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("skips filter entries with empty string values", async () => {
    queueExec({ stdout: "[]" });
    const { searchBeads } = await import("@/lib/bd");
    await searchBeads("query", { status: "", type: "bug" });
    // status should NOT appear in args since value is empty
    expect(execCalls[0]).not.toContain("--status");
    expect(execCalls[0]).toContain("--type");
    expect(execCalls[0]).toContain("bug");
  });
});

describe("updateBead error paths", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("returns error when showBead fails during stage label check (line 296)", async () => {
    // updateBead calls showBead when adding stage labels.
    // If showBead fails, it should return the error.
    queueExec(
      // showBead fails
      { stderr: "show failed", exitCode: 1 }
    );

    const { updateBead } = await import("@/lib/bd");
    const result = await updateBead("proj-abc", {
      labels: ["stage:verification"],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("show failed");
  });

  it("returns error when field update fails (line 317)", async () => {
    // updateBead with field updates + stage labels.
    // Field update runs in parallel with showBead. If field update fails,
    // it should return the error.
    const beadJson = JSON.stringify({
      ...BEAD_JSON,
      labels: [],
    });

    queueExec(
      // update --status fails
      { stderr: "update exploded", exitCode: 1 },
      // showBead succeeds
      { stdout: beadJson }
    );

    const { updateBead } = await import("@/lib/bd");
    const result = await updateBead("proj-abc", {
      status: "closed",
      labels: ["stage:verification"],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("update exploded");
  });

  it("returns error when label operation fails (line 348)", async () => {
    // Adding a non-stage label that fails during label add.
    queueExec(
      // label add fails
      { stderr: "label add exploded", exitCode: 1 }
    );

    const { updateBead } = await import("@/lib/bd");
    const result = await updateBead("proj-abc", {
      labels: ["my-custom-label"],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("label add exploded");
  });

  it("returns fallback error message when label op stderr is empty", async () => {
    queueExec(
      // label add fails with empty stderr
      { stderr: "", exitCode: 1 }
    );

    const { updateBead } = await import("@/lib/bd");
    const result = await updateBead("proj-abc", {
      labels: ["my-label"],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("bd label add my-label failed");
  });

  it("returns fallback error when update stderr is empty", async () => {
    const beadJson = JSON.stringify({
      ...BEAD_JSON,
      labels: [],
    });

    queueExec(
      // update fails with empty stderr
      { stderr: "", exitCode: 1 },
      // showBead succeeds
      { stdout: beadJson }
    );

    const { updateBead } = await import("@/lib/bd");
    const result = await updateBead("proj-abc", {
      status: "closed",
      labels: ["stage:verification"],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("bd update failed");
  });
});
