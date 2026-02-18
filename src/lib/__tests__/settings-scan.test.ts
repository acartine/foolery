import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:fs/promises
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

// Mock child_process.exec — promisify(exec) turns cb-based exec into promise-based.
// We mock exec as a cb-based function that delegates to mockExecCb for test control.
const mockExecCb = vi.fn();
vi.mock("node:child_process", () => ({
  exec: (cmd: string, cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
    const p = mockExecCb(cmd);
    p.then(
      (r: { stdout: string; stderr: string }) => cb(null, r),
      (e: Error) => cb(e),
    );
  },
}));

import { scanForAgents, _resetCache } from "@/lib/settings";

beforeEach(() => {
  vi.clearAllMocks();
  _resetCache();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
});

describe("scanForAgents", () => {
  it("returns installed status when agent is found on PATH", async () => {
    mockExecCb.mockResolvedValue({ stdout: "/usr/local/bin/claude\n", stderr: "" });

    const agents = await scanForAgents();
    expect(agents).toHaveLength(3); // claude, codex, gemini
    const claude = agents.find((a) => a.id === "claude");
    expect(claude?.installed).toBe(true);
    expect(claude?.path).toBe("/usr/local/bin/claude");
    expect(claude?.command).toBe("claude");
  });

  it("returns not-installed status when which fails", async () => {
    mockExecCb.mockRejectedValue(new Error("not found"));

    const agents = await scanForAgents();
    expect(agents).toHaveLength(3);
    for (const agent of agents) {
      expect(agent.installed).toBe(false);
      expect(agent.path).toBe("");
    }
  });

  it("handles mixed results (some installed, some not)", async () => {
    mockExecCb.mockImplementation(async (cmd: string) => {
      if (cmd === "which claude") {
        return { stdout: "/usr/bin/claude\n", stderr: "" };
      }
      throw new Error("not found");
    });

    const agents = await scanForAgents();
    const claude = agents.find((a) => a.id === "claude");
    const codex = agents.find((a) => a.id === "codex");
    const gemini = agents.find((a) => a.id === "gemini");

    expect(claude?.installed).toBe(true);
    expect(codex?.installed).toBe(false);
    expect(gemini?.installed).toBe(false);
  });

  it("scans for exactly claude, codex, and gemini", async () => {
    mockExecCb.mockRejectedValue(new Error("not found"));

    const agents = await scanForAgents();
    const ids = agents.map((a) => a.id);
    expect(ids).toEqual(["claude", "codex", "gemini"]);
  });
});
