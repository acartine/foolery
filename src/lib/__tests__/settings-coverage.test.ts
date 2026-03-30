import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockReaddir = vi.fn();
const mockAccess = vi.fn();
const mockStat = vi.fn();
const mockExecAsync = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  access: (...args: unknown[]) => mockAccess(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  chmod: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  exec: (...args: unknown[]) => {
    type ExecCb = (
      err: Error | null,
      result: { stdout: string; stderr: string },
    ) => void;
    const cb = args[args.length - 1] as ExecCb;
    const result = mockExecAsync((args[0] as string));
    if (result instanceof Error) {
      cb(result, { stdout: "", stderr: "" });
    } else {
      cb(null, result);
    }
  },
}));

import {
  getBackendType,
  scanForAgents,
  _resetCache,
} from "@/lib/settings";

beforeEach(() => {
  vi.clearAllMocks();
  _resetCache();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockReaddir.mockResolvedValue([]);
  mockAccess.mockRejectedValue(new Error("not executable"));
  mockStat.mockResolvedValue({ mtimeMs: 0 });
});

describe("getBackendType", () => {
  it("returns FOOLERY_BACKEND env var when set", async () => {
    const orig = process.env.FOOLERY_BACKEND;
    process.env.FOOLERY_BACKEND = "http";
    try {
      const type = await getBackendType();
      expect(type).toBe("http");
    } finally {
      if (orig !== undefined) process.env.FOOLERY_BACKEND = orig;
      else delete process.env.FOOLERY_BACKEND;
    }
  });

  it("returns settings backend type when env var not set", async () => {
    const orig = process.env.FOOLERY_BACKEND;
    delete process.env.FOOLERY_BACKEND;
    mockReadFile.mockResolvedValue('[backend]\ntype = "cli"');
    try {
      const type = await getBackendType();
      expect(type).toBe("cli");
    } finally {
      if (orig !== undefined) process.env.FOOLERY_BACKEND = orig;
    }
  });
});

describe("scanForAgents", () => {
  it("returns scan results for known agent CLIs", async () => {
    mockExecAsync.mockImplementation((cmd: string) => {
      if (cmd.includes("claude")) return { stdout: "/usr/local/bin/claude\n", stderr: "" };
      throw new Error("not found");
    });

    const results = await scanForAgents();
    expect(results).toHaveLength(5);

    const claude = results.find((r) => r.id === "claude");
    expect(claude?.installed).toBe(true);
    expect(claude?.path).toBe("/usr/local/bin/claude");
    expect(claude?.provider).toBe("Claude");

    const copilot = results.find((r) => r.id === "copilot");
    expect(copilot?.installed).toBe(false);
    expect(copilot?.provider).toBe("Copilot");

    const codex = results.find((r) => r.id === "codex");
    expect(codex?.installed).toBe(false);
    expect(codex?.provider).toBe("Codex");

    const opencode = results.find((r) => r.id === "opencode");
    expect(opencode?.installed).toBe(false);
    expect(opencode?.provider).toBe("OpenCode");
  });
});
