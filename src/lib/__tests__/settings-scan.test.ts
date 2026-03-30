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
    ...rest: unknown[]
  ) => {
    const cb = typeof rest[0] === "function"
      ? rest[0] as (
          err: Error | null,
          result?: { stdout: string; stderr: string },
        ) => void
      : rest[1] as (
          err: Error | null,
          result?: { stdout: string; stderr: string },
        ) => void;
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
  mockReadFile.mockRejectedValue(new Error("missing"));
});

describe("scanForAgents: discovery and status", () => {
  it("returns installed status when an agent is found on PATH", async () => {
    mockExecCb.mockImplementation(async (cmd: string) => {
      if (cmd === "command -v claude") {
        return { stdout: "/usr/local/bin/claude\n", stderr: "" };
      }
      throw new Error("not found");
    });

    const agents = await scanForAgents();
    expect(agents).toHaveLength(5);
    expect(agents.map((agent) => agent.id)).toEqual([
      "claude",
      "copilot",
      "codex",
      "gemini",
      "opencode",
    ]);

    const claude = agents.find((agent) => agent.id === "claude");
    expect(claude).toEqual({
      id: "claude",
      command: "claude",
      path: "/usr/local/bin/claude",
      installed: true,
      provider: "Claude",
      options: [
        { id: "claude", label: "Claude", provider: "Claude" },
      ],
      selectedOptionId: "claude",
    });
  });

  it("marks agents missing when command lookup fails", async () => {
    mockExecCb.mockRejectedValue(new Error("not found"));

    const agents = await scanForAgents();
    expect(agents).toHaveLength(5);
    for (const agent of agents) {
      expect(agent.installed).toBe(false);
      expect(agent.path).toBe("");
      expect(agent.provider).toBeTruthy();
      expect(agent.options?.length).toBeGreaterThan(0);
    }
  });

});

describe("scanForAgents: model metadata", () => {
  it("captures Copilot model metadata from local config", async () => {
    mockExecCb.mockImplementation(async (cmd: string) => {
      if (cmd === "command -v copilot") {
        return {
          stdout: "/opt/homebrew/bin/copilot\n",
          stderr: "",
        };
      }
      if (cmd === "copilot help config") {
        return {
          stdout: [
            "  `model`: AI model to use",
            '    - "claude-sonnet-4.5"',
            '    - "gpt-5.2"',
            "",
            "  `mouse`: enable mouse",
          ].join("\n"),
          stderr: "",
        };
      }
      throw new Error("not found");
    });
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith(".copilot/config.json")) {
        return JSON.stringify({
          defaultModel: "claude-sonnet-4.5",
        });
      }
      throw new Error("missing");
    });

    const agents = await scanForAgents();
    const copilot = agents.find((agent) => agent.id === "copilot");
    expect(copilot).toMatchObject({
      id: "copilot",
      command: "copilot",
      path: "/opt/homebrew/bin/copilot",
      installed: true,
      provider: "Claude",
      model: "claude",
      flavor: "sonnet",
      modelId: "claude-sonnet-4.5",
      version: "4.5",
    });
    expect(copilot?.options?.length).toBe(2);
    expect(copilot?.options?.[0]).toMatchObject({
      id: "copilot-claude-sonnet-4-5",
      provider: "Claude",
      model: "claude",
      flavor: "sonnet",
      version: "4.5",
      modelId: "claude-sonnet-4.5",
    });
    expect(copilot?.options?.[1]).toMatchObject({
      modelId: "gpt-5.2",
    });
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
    const codex = agents.find((agent) => agent.id === "codex");
    expect(codex).toMatchObject({
      id: "codex",
      command: "codex",
      path: "/opt/homebrew/bin/codex",
      installed: true,
      provider: "Codex",
      model: "gpt",
      modelId: "gpt-5.4",
      version: "5.4",
    });
    expect(codex?.options?.length).toBeGreaterThan(0);
    expect(codex?.selectedOptionId).toBeTruthy();
  });
});

describe("scanForAgents: model metadata for existing CLIs", () => {
  it("captures Claude model metadata from settings", async () => {
    mockExecCb.mockImplementation(async (cmd: string) => {
      if (cmd === "command -v claude") {
        return { stdout: "/usr/local/bin/claude\n", stderr: "" };
      }
      throw new Error("not found");
    });
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith(".claude/settings.json")) {
        return JSON.stringify({
          defaultModel: "claude-sonnet-4-5",
        });
      }
      throw new Error("missing");
    });

    const agents = await scanForAgents();
    const claude = agents.find((agent) => agent.id === "claude");
    expect(claude).toMatchObject({
      id: "claude",
      command: "claude",
      path: "/usr/local/bin/claude",
      installed: true,
      provider: "Claude",
      model: "claude",
      flavor: "sonnet",
      modelId: "claude-sonnet-4-5",
      version: "4.5",
    });
    expect(claude?.options?.length).toBeGreaterThan(0);
    expect(claude?.options?.[0]?.label).toBe("Claude Sonnet 4.5");
  });

  it("captures Gemini model metadata from recent history", async () => {
    mockExecCb.mockImplementation(async (cmd: string) => {
      if (cmd === "command -v gemini") {
        return {
          stdout: "/opt/homebrew/bin/gemini\n",
          stderr: "",
        };
      }
      throw new Error("not found");
    });
    mockReaddir.mockImplementation(async (path: string) => {
      if (path.endsWith(".gemini/tmp")) return ["workspace-a"];
      if (path.endsWith("workspace-a/chats")) {
        return ["session.json"];
      }
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
    const gemini = agents.find((agent) => agent.id === "gemini");
    expect(gemini).toMatchObject({
      id: "gemini",
      command: "gemini",
      path: "/opt/homebrew/bin/gemini",
      installed: true,
      provider: "Gemini",
      model: "gemini",
      flavor: "pro",
      modelId: "gemini-2.5-pro",
      version: "2.5",
    });
    expect(gemini?.options?.length).toBeGreaterThan(0);
    expect(gemini?.options?.[0]?.label).toBe("Gemini Pro 2.5");
  });
});

describe("scanForAgents: copilot dynamic model discovery", () => {
  it("returns all models from copilot help config", async () => {
    mockExecCb.mockImplementation(async (cmd: string) => {
      if (cmd === "command -v copilot") {
        return {
          stdout: "/opt/homebrew/bin/copilot\n",
          stderr: "",
        };
      }
      if (cmd === "copilot help config") {
        return {
          stdout: [
            "  `model`: AI model to use",
            '    - "claude-sonnet-4.6"',
            '    - "claude-opus-4.6"',
            '    - "gpt-5.4"',
            '    - "gemini-3-pro-preview"',
            "",
            "  `mouse`: enable mouse",
          ].join("\n"),
          stderr: "",
        };
      }
      throw new Error("not found");
    });

    const agents = await scanForAgents();
    const copilot = agents.find((a) => a.id === "copilot");
    expect(copilot?.installed).toBe(true);
    expect(copilot?.options?.length).toBe(4);
    const ids = copilot?.options?.map((o) => o.modelId);
    expect(ids).toEqual([
      "claude-sonnet-4.6",
      "claude-opus-4.6",
      "gpt-5.4",
      "gemini-3-pro-preview",
    ]);
  });

  it("falls back to config model when help config fails", async () => {
    mockExecCb.mockImplementation(async (cmd: string) => {
      if (cmd === "command -v copilot") {
        return {
          stdout: "/opt/homebrew/bin/copilot\n",
          stderr: "",
        };
      }
      throw new Error("not found");
    });
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith(".copilot/config.json")) {
        return JSON.stringify({ model: "gpt-5.2" });
      }
      throw new Error("missing");
    });

    const agents = await scanForAgents();
    const copilot = agents.find((a) => a.id === "copilot");
    expect(copilot?.installed).toBe(true);
    expect(copilot?.options?.length).toBe(1);
    expect(copilot?.options?.[0]?.modelId).toBe("gpt-5.2");
  });
});
