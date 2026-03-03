import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecFile = vi.fn();
const mockSpawn = vi.fn();
const mockPlatform = vi.fn();
let lastSpawnInput = "";

type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

function execFileSuccess(stdout = "") {
  return (
    _command: string,
    _args: string[],
    _options: { encoding: string },
    callback: ExecFileCallback,
  ) => {
    callback(null, stdout, "");
    return {} as unknown;
  };
}

function execFileFailure(message = "failure") {
  return (
    _command: string,
    _args: string[],
    _options: { encoding: string },
    callback: ExecFileCallback,
  ) => {
    callback(new Error(message), "", "");
    return {} as unknown;
  };
}

function spawnResult(options?: {
  exitCode?: number;
  stderr?: string;
  error?: Error;
}) {
  return () => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stderr: PassThrough;
    };
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();

    const originalEnd = child.stdin.end.bind(child.stdin);
    child.stdin.end = ((chunk?: string | Uint8Array) => {
      if (typeof chunk === "string") {
        lastSpawnInput = chunk;
      } else if (chunk instanceof Uint8Array) {
        lastSpawnInput = Buffer.from(chunk).toString("utf8");
      }
      return originalEnd(chunk);
    }) as typeof child.stdin.end;

    setImmediate(() => {
      if (options?.error) {
        child.emit("error", options.error);
        return;
      }
      if (options?.stderr) {
        child.stderr.write(options.stderr);
      }
      child.stderr.end();
      child.emit("close", options?.exitCode ?? 0);
    });

    return child;
  };
}

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock("node:os", () => ({
  platform: () => mockPlatform(),
  homedir: () => "/mock/home",
}));

// Must import AFTER mocking
const { keychainSet, keychainGet, keychainDelete } = await import(
  "@/lib/keychain"
);

beforeEach(() => {
  vi.clearAllMocks();
  lastSpawnInput = "";
});

describe("keychainGet", () => {
  it("reads from macOS keychain", async () => {
    mockPlatform.mockReturnValue("darwin");
    mockExecFile.mockImplementation(execFileSuccess("sk-or-v1-secret\n"));

    const result = await keychainGet();
    expect(result).toBe("sk-or-v1-secret");
    expect(mockExecFile).toHaveBeenCalledWith(
      "security",
      expect.arrayContaining(["find-generic-password"]),
      { encoding: "utf8" },
      expect.any(Function),
    );
  });

  it("reads from Linux secret-tool", async () => {
    mockPlatform.mockReturnValue("linux");
    mockExecFile.mockImplementation(execFileSuccess("linux-secret\n"));

    const result = await keychainGet();
    expect(result).toBe("linux-secret");
    expect(mockExecFile).toHaveBeenCalledWith(
      "secret-tool",
      expect.arrayContaining(["lookup"]),
      { encoding: "utf8" },
      expect.any(Function),
    );
  });

  it("returns null when keychain entry not found", async () => {
    mockPlatform.mockReturnValue("darwin");
    mockExecFile.mockImplementation(execFileFailure("not found"));

    const result = await keychainGet();
    expect(result).toBeNull();
  });

  it("returns null on unsupported OS", async () => {
    mockPlatform.mockReturnValue("win32");

    const result = await keychainGet();
    expect(result).toBeNull();
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});

describe("keychainSet", () => {
  it("stores in macOS keychain", async () => {
    mockPlatform.mockReturnValue("darwin");
    mockExecFile
      .mockImplementationOnce(execFileSuccess())
      .mockImplementationOnce(execFileSuccess());

    const result = await keychainSet("my-secret");
    expect(result).toBe(true);
    expect(mockExecFile).toHaveBeenCalledTimes(2);
    expect(mockExecFile.mock.calls[1][0]).toBe("security");
    expect(mockExecFile.mock.calls[1][1]).toEqual(
      expect.arrayContaining(["add-generic-password", "-w", "my-secret"]),
    );
  });

  it("stores in Linux secret-tool", async () => {
    mockPlatform.mockReturnValue("linux");
    mockSpawn.mockImplementation(spawnResult());

    const result = await keychainSet("my-secret");
    expect(result).toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith(
      "secret-tool",
      [
        "store",
        "--label=Foolery OpenRouter API Key",
        "application",
        "foolery",
        "key",
        "openrouter-api-key",
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    expect(lastSpawnInput).toBe("my-secret");
  });

  it("returns false on unsupported OS", async () => {
    mockPlatform.mockReturnValue("win32");

    const result = await keychainSet("my-secret");
    expect(result).toBe(false);
  });

  it("returns false on command failure", async () => {
    mockPlatform.mockReturnValue("darwin");
    mockExecFile
      .mockImplementationOnce(execFileSuccess())
      .mockImplementationOnce(execFileFailure("permission denied"));

    const result = await keychainSet("my-secret");
    expect(result).toBe(false);
  });

  it("delegates to keychainDelete when key is empty", async () => {
    mockPlatform.mockReturnValue("darwin");
    mockExecFile.mockImplementation(execFileSuccess());

    const result = await keychainSet("");
    expect(result).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      "security",
      expect.arrayContaining(["delete-generic-password"]),
      { encoding: "utf8" },
      expect.any(Function),
    );
  });
});

describe("keychainDelete", () => {
  it("deletes from macOS keychain", async () => {
    mockPlatform.mockReturnValue("darwin");
    mockExecFile.mockImplementation(execFileSuccess());

    const result = await keychainDelete();
    expect(result).toBe(true);
  });

  it("deletes from Linux secret-tool", async () => {
    mockPlatform.mockReturnValue("linux");
    mockExecFile.mockImplementation(execFileSuccess());

    const result = await keychainDelete();
    expect(result).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      "secret-tool",
      expect.arrayContaining(["clear"]),
      { encoding: "utf8" },
      expect.any(Function),
    );
  });

  it("returns true even if entry didn't exist", async () => {
    mockPlatform.mockReturnValue("darwin");
    mockExecFile.mockImplementation(execFileFailure("not found"));

    const result = await keychainDelete();
    expect(result).toBe(true);
  });

  it("returns false on unsupported OS", async () => {
    mockPlatform.mockReturnValue("win32");

    const result = await keychainDelete();
    expect(result).toBe(false);
  });
});
