import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockReaddir = vi.fn();
const mockStat = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  chmod: vi.fn(),
}));

const mockExecCb = vi.fn();
vi.mock("node:child_process", () => ({
  exec: (
    cmd: string,
    cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
  ) => {
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
  mockReaddir.mockResolvedValue([]);
  mockStat.mockResolvedValue({ mtimeMs: 0 });
});

describe("scanForAgents", () => {
  it("returns installed status when an agent is found on PATH", async () => {
    mockExecCb.mockImplementation(async (cmd: string) => {
      if (cmd === "command -v claude") {
        return { stdout: "/usr/local/bin/claude\n", stderr: "" };
      }
      throw new Error("not found");
    });

    const agents = await scanForAgents();
    expect(agents).toHaveLength(3);
    expect(agents.map((agent) => agent.id)).toEqual(["claude", "codex", "gemini"]);

    const claude = agents.find((agent) => agent.id === "claude");
    expect(claude).toEqual({
      id: "claude",
      command: "claude",
      path: "/usr/local/bin/claude",
      installed: true,
      provider: "Claude",
      options: [
        { id: "claude-opus-4-5", label: "Claude Opus 4.5", provider: "Claude", model: "opus", version: "4.5" },
        { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", provider: "Claude", model: "sonnet", version: "4.5" },
        { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "Claude", model: "haiku", version: "4.5" },
      ],
      selectedOptionId: "claude-opus-4-5",
    });
  });

  it("marks agents missing when command lookup fails", async () => {
    mockExecCb.mockRejectedValue(new Error("not found"));

    const agents = await scanForAgents();
    expect(agents).toHaveLength(3);
    for (const agent of agents) {
      expect(agent.installed).toBe(false);
      expect(agent.path).toBe("");
      expect(agent.provider).toBeTruthy();
      expect(agent.options?.length).toBeGreaterThan(0);
    }
  });

  it("captures Codex model metadata from local config", async () => {
    mockExecCb.mockImplementation(async (cmd: string) => {
      if (cmd === "command -v codex") {
        return { stdout: "/opt/homebrew/bin/codex\n", stderr: "" };
      }
      throw new Error("not found");
    });
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith(".codex/config.toml")) {
        return 'model = "gpt-5.4"\n';
      }
      throw new Error("missing");
    });

    const agents = await scanForAgents();
    expect(agents.find((agent) => agent.id === "codex")).toEqual({
      id: "codex",
      command: "codex",
      path: "/opt/homebrew/bin/codex",
      installed: true,
      provider: "OpenAI",
      model: "codex",
      version: "5.4",
      options: [
        { id: "codex-codex-5-4", label: "OpenAI Codex 5.4", provider: "OpenAI", model: "codex", version: "5.4" },
        { id: "codex-gpt-5-4", label: "OpenAI GPT 5.4", provider: "OpenAI", model: "gpt", version: "5.4" },
        { id: "codex-codex-spark-5-4", label: "OpenAI Codex Spark 5.4", provider: "OpenAI", model: "codex-spark", version: "5.4" },
        { id: "codex-codex-max-5-4", label: "OpenAI Codex Max 5.4", provider: "OpenAI", model: "codex-max", version: "5.4" },
        { id: "codex-codex-mini-5-4", label: "OpenAI Codex Mini 5.4", provider: "OpenAI", model: "codex-mini", version: "5.4" },
      ],
      selectedOptionId: "codex-codex-5-4",
    });
  });

  it("captures Claude model metadata from settings when available", async () => {
    mockExecCb.mockImplementation(async (cmd: string) => {
      if (cmd === "command -v claude") {
        return { stdout: "/usr/local/bin/claude\n", stderr: "" };
      }
      throw new Error("not found");
    });
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith(".claude/settings.json")) {
        return JSON.stringify({ defaultModel: "claude-sonnet-4-5" });
      }
      throw new Error("missing");
    });

    const agents = await scanForAgents();
    expect(agents.find((agent) => agent.id === "claude")).toEqual({
      id: "claude",
      command: "claude",
      path: "/usr/local/bin/claude",
      installed: true,
      provider: "Claude",
      model: "sonnet",
      version: "4.5",
      options: [
        { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", provider: "Claude", model: "sonnet", version: "4.5" },
        { id: "claude-opus-4-5", label: "Claude Opus 4.5", provider: "Claude", model: "opus", version: "4.5" },
        { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "Claude", model: "haiku", version: "4.5" },
      ],
      selectedOptionId: "claude-sonnet-4-5",
    });
  });

  it("captures Gemini model metadata from recent history when available", async () => {
    mockExecCb.mockImplementation(async (cmd: string) => {
      if (cmd === "command -v gemini") {
        return { stdout: "/opt/homebrew/bin/gemini\n", stderr: "" };
      }
      throw new Error("not found");
    });
    mockReaddir.mockImplementation(async (path: string) => {
      if (path.endsWith(".gemini/tmp")) return ["workspace-a"];
      if (path.endsWith(".gemini/tmp/workspace-a/chats")) return ["session.json"];
      return [];
    });
    mockStat.mockResolvedValue({ mtimeMs: 10 });
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith("session.json")) {
        return JSON.stringify({ model: "gemini-2.5-pro" });
      }
      throw new Error("missing");
    });

    const agents = await scanForAgents();
    expect(agents.find((agent) => agent.id === "gemini")).toEqual({
      id: "gemini",
      command: "gemini",
      path: "/opt/homebrew/bin/gemini",
      installed: true,
      provider: "Gemini",
      model: "pro",
      version: "2.5",
      options: [
        { id: "gemini-pro-2-5", label: "Gemini Pro 2.5", provider: "Gemini", model: "pro", version: "2.5" },
        { id: "gemini-flash-2-5", label: "Gemini Flash 2.5", provider: "Gemini", model: "flash", version: "2.5" },
        { id: "gemini-flash-lite-2-5", label: "Gemini Flash Lite 2.5", provider: "Gemini", model: "flash-lite", version: "2.5" },
      ],
      selectedOptionId: "gemini-pro-2-5",
    });
  });
});
