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

describe("updateBead label transitions", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("removes stale stage label when adding a new stage label", async () => {
    const beadJson = JSON.stringify({
      id: "foolery-123",
      issue_type: "task",
      status: "closed",
      priority: 2,
      labels: ["stage:verification", "attempts:2", "foo"],
      created_at: "2026-02-13T00:00:00.000Z",
      updated_at: "2026-02-13T00:00:00.000Z",
    });

    queueExec(
      { stdout: beadJson }, // show
      { stdout: "" }, // update --status
      { stdout: "" }, // remove stage:verification
      { stdout: "" }, // remove attempts:2
      { stdout: "" }, // add stage:retry
      { stdout: "" }, // add attempts:3
      { stdout: "" } // sync
    );

    const { updateBead } = await import("@/lib/bd");

    const result = await updateBead("foolery-123", {
      status: "open",
      removeLabels: ["attempts:2"],
      labels: ["stage:retry", "attempts:3"],
    });

    expect(result).toEqual({ ok: true });
    expect(execCalls).toContainEqual(["show", "foolery-123", "--json"]);
    expect(execCalls).toContainEqual(["update", "foolery-123", "--status", "open"]);
    expect(execCalls).toContainEqual(["label", "remove", "foolery-123", "stage:verification", "--no-daemon"]);
    expect(execCalls).toContainEqual(["label", "remove", "foolery-123", "attempts:2", "--no-daemon"]);
    expect(execCalls).toContainEqual(["label", "add", "foolery-123", "stage:retry", "--no-daemon"]);
    expect(execCalls).toContainEqual(["label", "add", "foolery-123", "attempts:3", "--no-daemon"]);
    expect(execCalls).toContainEqual(["sync", "--no-daemon"]);
  });

  it("fails when sync fails after label mutation", async () => {
    const beadJson = JSON.stringify({
      id: "foolery-456",
      issue_type: "task",
      status: "closed",
      priority: 2,
      labels: ["stage:verification"],
      created_at: "2026-02-13T00:00:00.000Z",
      updated_at: "2026-02-13T00:00:00.000Z",
    });

    queueExec(
      { stdout: beadJson }, // show
      { stdout: "" }, // remove stage:verification
      { stdout: "" }, // add stage:retry
      { stderr: "sync exploded", exitCode: 1 } // sync
    );

    const { updateBead } = await import("@/lib/bd");

    const result = await updateBead("foolery-456", {
      labels: ["stage:retry"],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("sync");
    expect(execCalls).toContainEqual(["label", "remove", "foolery-456", "stage:verification", "--no-daemon"]);
    expect(execCalls).toContainEqual(["label", "add", "foolery-456", "stage:retry", "--no-daemon"]);
  });
});
