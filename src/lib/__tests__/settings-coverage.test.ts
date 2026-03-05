import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockExecAsync = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

vi.mock("node:child_process", () => ({
  exec: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
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
  getOpenRouterSettings,
  scanForAgents,
  _resetCache,
} from "@/lib/settings";

beforeEach(() => {
  vi.clearAllMocks();
  _resetCache();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
});

describe("getBackendType (line 311-315)", () => {
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

describe("getOpenRouterSettings (line 361-362)", () => {
  it("returns default openrouter settings", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const or = await getOpenRouterSettings();
    expect(or.enabled).toBe(false);
    expect(or.apiKey).toBe("");
    expect(or.agents).toEqual({});
    expect(or.model).toBe("");
  });

  it("returns configured openrouter settings", async () => {
    const toml = [
      "[openrouter]",
      'apiKey = "sk-test"',
      "enabled = true",
      'model = "anthropic/claude-sonnet-4"',
    ].join("\n");
    mockReadFile.mockResolvedValue(toml);
    const or = await getOpenRouterSettings();
    expect(or.enabled).toBe(true);
    expect(or.apiKey).toBe("sk-test");
    expect(or.model).toBe("anthropic/claude-sonnet-4");
    expect(or.agents).toEqual({
      default: {
        model: "anthropic/claude-sonnet-4",
        label: "OpenRouter (anthropic/claude-sonnet-4)",
      },
    });
  });
});

describe("scanForAgents (line 345-357)", () => {
  it("returns scan results for known agent CLIs", async () => {
    mockExecAsync.mockImplementation((cmd: string) => {
      if (cmd.includes("claude")) return { stdout: "/usr/local/bin/claude\n", stderr: "" };
      throw new Error("not found");
    });

    const results = await scanForAgents();
    expect(results).toHaveLength(4);

    const claude = results.find((r) => r.id === "claude");
    expect(claude?.installed).toBe(true);
    expect(claude?.path).toBe("/usr/local/bin/claude");

    const codex = results.find((r) => r.id === "codex");
    expect(codex?.installed).toBe(false);

    const openrouterAgent = results.find((r) => r.id === "openrouter-agent");
    expect(openrouterAgent?.installed).toBe(false);
  });
});
