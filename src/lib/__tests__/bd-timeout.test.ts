import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockExecResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  killed?: boolean;
}

const execInvocations: { args: string[]; options: { timeout?: number } }[] = [];
const execQueue: MockExecResult[] = [];

const execFileMock = vi.fn(
  (
    _file: string,
    args: string[],
    options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ) => {
    execInvocations.push({
      args,
      options: (options as { timeout?: number }) ?? {},
    });

    const next = execQueue.shift() ?? { exitCode: 0, stdout: "", stderr: "" };
    if (next.killed) {
      const err = Object.assign(new Error("mock timeout"), {
        code: null,
        killed: true,
        signal: "SIGKILL",
      });
      callback(err, next.stdout ?? "", next.stderr ?? "");
      return;
    }

    const code = next.exitCode ?? 0;
    const error =
      code === 0
        ? null
        : Object.assign(new Error(next.stderr || "mock exec failure"), { code });
    callback(error, next.stdout ?? "", next.stderr ?? "");
  }
);

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

function queueExec(...responses: MockExecResult[]): void {
  execQueue.push(...responses);
}

describe("bd command timeout handling", () => {
  beforeEach(() => {
    execInvocations.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("retries timed out read commands once, then returns timeout error", async () => {
    queueExec({ killed: true }, { killed: true });

    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads(undefined, "/Users/cartine/foolery");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("bd command timed out after");
    expect(execInvocations).toHaveLength(2);
    expect(execInvocations[0].args[0]).toBe("list");
    expect(execInvocations[1].args[0]).toBe("list");
    const options = execInvocations[0].options;
    expect(options.timeout).toBeGreaterThan(0);
  });

  it("retries idempotent write commands once and succeeds", async () => {
    const beadJson = JSON.stringify({
      id: "foolery-123",
      title: "Retry timeout",
      status: "open",
      issue_type: "task",
      priority: 2,
      labels: [],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });

    queueExec(
      { stdout: beadJson }, // show (context load)
      { stdout: beadJson }, // show (label reconciliation)
      { killed: true }, // update timeout (attempt 1)
      { stdout: "" }, // update retry succeeds
      { stdout: "" }, // label add wf:state:*
      { stdout: "" }, // label add wf:profile:*
    );

    const { updateBead } = await import("@/lib/bd");
    const result = await updateBead(
      "foolery-123",
      { status: "open" },
      "/Users/cartine/foolery"
    );

    expect(result.ok).toBe(true);
    expect(execInvocations.length).toBeGreaterThanOrEqual(6);
    expect(execInvocations[0].args[0]).toBe("show");
    expect(execInvocations.some((call) => call.args[0] === "update")).toBe(true);
    expect(execInvocations.some((call) => call.args[0] === "label")).toBe(true);
  });

  it("does not retry non-idempotent writes after timeout", async () => {
    queueExec({ killed: true });

    const { createBead } = await import("@/lib/bd");
    const result = await createBead({ title: "new" }, "/Users/cartine/foolery");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("bd command timed out after");
    expect(execInvocations).toHaveLength(1);
    expect(execInvocations[0].args[0]).toBe("create");
  });
});
