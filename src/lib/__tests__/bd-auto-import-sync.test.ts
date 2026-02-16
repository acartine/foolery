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

describe("bd auto-import retry for out-of-sync repos", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("runs `bd sync --import-only` and retries list once on out-of-sync error", async () => {
    queueExec(
      {
        stdout: JSON.stringify({
          error: "Database out of sync with JSONL. Run 'bd sync --import-only' to fix.",
        }),
        exitCode: 1,
      },
      { stdout: "Import complete", exitCode: 0 },
      { stdout: "[]", exitCode: 0 }
    );

    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads(undefined, "/Users/cartine/foolery");

    expect(result).toEqual({ ok: true, data: [] });
    expect(execCalls).toEqual([
      ["list", "--json", "--limit", "0", "--all"],
      ["sync", "--import-only"],
      ["list", "--json", "--limit", "0", "--all"],
    ]);
  });

  it("does not retry for non-out-of-sync errors", async () => {
    queueExec({ stderr: "permission denied", exitCode: 1 });

    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads(undefined, "/Users/cartine/foolery");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("permission denied");
    expect(execCalls).toEqual([["list", "--json", "--limit", "0", "--all"]]);
  });
});
