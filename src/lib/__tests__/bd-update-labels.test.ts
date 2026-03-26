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

describe("updateBeat label transitions", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  describe("stage label reconciliation", () => {
    it("removes stale stage label when adding a new stage label", async () => {
    const beatJson = JSON.stringify({
      id: "foolery-123",
      issue_type: "task",
      status: "closed",
      priority: 2,
      labels: ["stage:implementation", "attempts:2", "foo"],
      created_at: "2026-02-13T00:00:00.000Z",
      updated_at: "2026-02-13T00:00:00.000Z",
    });

    queueExec(
      { stdout: beatJson }, // show (context load)
      { stdout: beatJson }, // show (label reconciliation)
      { stdout: "" }, // update --status
    );

    const { updateBeat } = await import("@/lib/bd");

    const result = await updateBeat("foolery-123", {
      status: "open",
      removeLabels: ["attempts:2"],
      labels: ["stage:retry", "attempts:3"],
    });

    expect(result).toEqual({ ok: true });
    expect(execCalls).toContainEqual(["show", "foolery-123", "--json"]);
    expect(execCalls).toContainEqual(["update", "foolery-123", "--status", "open"]);
    expect(execCalls).toContainEqual(["label", "remove", "foolery-123", "stage:implementation", "--no-daemon"]);
    expect(execCalls).toContainEqual(["label", "remove", "foolery-123", "attempts:2", "--no-daemon"]);
    expect(execCalls).toContainEqual(["label", "add", "foolery-123", "stage:retry", "--no-daemon"]);
    expect(execCalls).toContainEqual(["label", "add", "foolery-123", "attempts:3", "--no-daemon"]);
    expect(execCalls).toContainEqual(["sync", "--no-daemon"]);
  });

    it("fails when sync fails after label mutation", async () => {
    const beatJson = JSON.stringify({
      id: "foolery-456",
      issue_type: "task",
      status: "closed",
      priority: 2,
      labels: ["stage:implementation"],
      created_at: "2026-02-13T00:00:00.000Z",
      updated_at: "2026-02-13T00:00:00.000Z",
    });

    queueExec(
      { stdout: beatJson }, // show
      { stdout: "" }, // remove stage:implementation
      { stdout: "" }, // add stage:retry
      { stderr: "sync exploded", exitCode: 1 } // sync
    );

    const { updateBeat } = await import("@/lib/bd");

    const result = await updateBeat("foolery-456", {
      labels: ["stage:retry"],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("sync");
    expect(execCalls).toContainEqual(["label", "remove", "foolery-456", "stage:implementation", "--no-daemon"]);
    expect(execCalls).toContainEqual(["label", "add", "foolery-456", "stage:retry", "--no-daemon"]);
    });
  });

});

describe("updateBeat --no-daemon flag fallback", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  describe("--no-daemon flag fallback", () => {
    it("retries label add without --no-daemon when flag is unsupported", async () => {
    queueExec(
      { stderr: "unknown flag: --no-daemon", exitCode: 1 }, // add with --no-daemon
      { stdout: "" } // add fallback without --no-daemon
    );

    const { updateBeat } = await import("@/lib/bd");

    const result = await updateBeat("foolery-789", {
      labels: ["orchestration:wave"],
    });

    expect(result).toEqual({ ok: true });
    expect(execCalls).toContainEqual([
      "label",
      "add",
      "foolery-789",
      "orchestration:wave",
      "--no-daemon",
    ]);
    expect(execCalls).toContainEqual([
      "label",
      "add",
      "foolery-789",
      "orchestration:wave",
    ]);
  });

  it("retries sync without --no-daemon when flag is unsupported", async () => {
    queueExec(
      { stdout: "" }, // remove label with --no-daemon
      { stderr: "unknown flag: --no-daemon", exitCode: 1 }, // sync with --no-daemon
      { stdout: "" } // sync fallback without --no-daemon
    );

    const { updateBeat } = await import("@/lib/bd");

    const result = await updateBeat("foolery-101", {
      removeLabels: ["legacy:label"],
    });

    expect(result).toEqual({ ok: true });
    expect(execCalls).toContainEqual([
      "label",
      "remove",
      "foolery-101",
      "legacy:label",
      "--no-daemon",
    ]);
    expect(execCalls).toContainEqual(["sync", "--no-daemon"]);
    expect(execCalls).toContainEqual(["sync"]);
    });
  });
});
