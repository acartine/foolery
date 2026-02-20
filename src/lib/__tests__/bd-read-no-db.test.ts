import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockExecResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

interface ExecInvocation {
  args: string[];
  env: NodeJS.ProcessEnv;
}

const execInvocations: ExecInvocation[] = [];
const execQueue: MockExecResult[] = [];

const execFileMock = vi.fn(
  (
    _file: string,
    args: string[],
    options: { env?: NodeJS.ProcessEnv },
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ) => {
    execInvocations.push({ args, env: options.env ?? {} });
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

describe("bd read-mode BD_NO_DB behavior", () => {
  beforeEach(() => {
    execInvocations.length = 0;
    execQueue.length = 0;
    execFileMock.mockClear();
    delete process.env.BD_NO_DB;
    delete process.env.FOOLERY_BD_READ_NO_DB;
    vi.resetModules();
  });

  it("sets BD_NO_DB=true for read commands by default", async () => {
    queueExec({ stdout: "[]" });
    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads();

    expect(result).toEqual({ ok: true, data: [] });
    expect(execInvocations).toHaveLength(1);
    expect(execInvocations[0].args[0]).toBe("list");
    expect(execInvocations[0].env.BD_NO_DB).toBe("true");
  });

  it("does not force BD_NO_DB for write commands", async () => {
    queueExec({ stdout: JSON.stringify({ id: "foolery-new" }) });
    const { createBead } = await import("@/lib/bd");
    const result = await createBead({ title: "new bead" });

    expect(result).toEqual({ ok: true, data: { id: "foolery-new" } });
    expect(execInvocations).toHaveLength(1);
    expect(execInvocations[0].args[0]).toBe("create");
    expect(execInvocations[0].env.BD_NO_DB).toBeUndefined();
  });

  it("retries read commands with BD_NO_DB=true after nil panic when default is disabled", async () => {
    process.env.FOOLERY_BD_READ_NO_DB = "0";
    queueExec(
      {
        stderr:
          "panic: runtime error: invalid memory address or nil pointer dereference",
        exitCode: 1,
      },
      { stdout: "[]" }
    );

    const { listBeads } = await import("@/lib/bd");
    const result = await listBeads();

    expect(result).toEqual({ ok: true, data: [] });
    expect(execInvocations).toHaveLength(2);
    expect(execInvocations[0].env.BD_NO_DB).toBeUndefined();
    expect(execInvocations[1].env.BD_NO_DB).toBe("true");
  });
});
