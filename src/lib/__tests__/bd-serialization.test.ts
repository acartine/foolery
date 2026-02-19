import { beforeEach, describe, expect, it, vi } from "vitest";

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

const execCalls: string[][] = [];
const pendingExecs: ExecCallback[] = [];

const execFileMock = vi.fn(
  (
    _file: string,
    args: string[],
    _options: unknown,
    callback: ExecCallback
  ) => {
    execCalls.push(args);
    pendingExecs.push(callback);
  }
);

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

function resolveNext(stdout = "[]"): void {
  const callback = pendingExecs.shift();
  if (!callback) throw new Error("No pending exec callback");
  callback(null, stdout, "");
}

describe("bd execution serialization", () => {
  beforeEach(() => {
    execCalls.length = 0;
    pendingExecs.length = 0;
    execFileMock.mockClear();
    vi.resetModules();
  });

  it("serializes concurrent calls for the same repo path", async () => {
    const repoPath = "/Users/cartine/foolery";
    const { listBeads } = await import("@/lib/bd");

    const first = listBeads(undefined, repoPath);
    const second = listBeads(undefined, repoPath);
    await vi.waitFor(() => {
      expect(execCalls).toHaveLength(1);
    });

    resolveNext();
    await vi.waitFor(() => {
      expect(execCalls).toHaveLength(2);
    });

    resolveNext();
    await expect(first).resolves.toEqual({ ok: true, data: [] });
    await expect(second).resolves.toEqual({ ok: true, data: [] });
  });

  it("allows concurrent calls for different repo paths", async () => {
    const { listBeads } = await import("@/lib/bd");

    const first = listBeads(undefined, "/Users/cartine/foolery");
    const second = listBeads(undefined, "/Users/cartine/1brutus");
    await vi.waitFor(() => {
      expect(execCalls).toHaveLength(2);
    });

    resolveNext();
    resolveNext();
    await expect(first).resolves.toEqual({ ok: true, data: [] });
    await expect(second).resolves.toEqual({ ok: true, data: [] });
  });
});
