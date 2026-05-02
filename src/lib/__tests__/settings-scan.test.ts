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
    expect(claude).toMatchObject({
      id: "claude",
      command: "claude",
      path: "/usr/local/bin/claude",
      installed: true,
      provider: "Claude",
      selectedOptionId: "claude-claude-opus-4-7",
    });
    expect(claude?.options?.map((option) => option.label)).toEqual([
      "Claude Opus 4.7",
      "Claude Sonnet 4.6",
      "Claude Opus 4.6",
      "Claude Sonnet 4.5",
      "Claude Haiku 4.5",
      "Claude Opus 4.5",
    ]);
    expect(claude?.options?.[0]).toMatchObject({
      id: "claude-claude-opus-4-7",
      modelId: "claude-opus-4-7",
      provider: "Claude",
      // Display-form per foolery-b42b.
      model: "Claude",
      flavor: "Opus",
      version: "4.7",
      label: "Claude Opus 4.7",
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

describe("scanForAgents: copilot model metadata", () => {
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
    // Copilot is always the provider — even when routing Anthropic
    // weights — so the runtime engine shows in the label. The inner
    // family becomes model + flavor.
    expect(copilot).toMatchObject({
      id: "copilot",
      command: "copilot",
      path: "/opt/homebrew/bin/copilot",
      installed: true,
      provider: "Copilot",
      model: "Claude",
      flavor: "Sonnet",
      modelId: "claude-sonnet-4.5",
      version: "4.5",
    });
    expect(copilot?.options?.length).toBe(2);
    expect(copilot?.options?.[0]).toMatchObject({
      id: "copilot-claude-sonnet-4-5",
      label: "Copilot Claude Sonnet 4.5",
      provider: "Copilot",
      model: "Claude",
      flavor: "Sonnet",
      version: "4.5",
      modelId: "claude-sonnet-4.5",
    });
    expect(copilot?.options?.[1]).toMatchObject({
      modelId: "gpt-5.2",
    });
  });
});

describe("scanForAgents: codex model metadata", () => {
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
      model: "GPT",
      modelId: "gpt-5.4",
      version: "5.4",
    });
    expect(codex?.options?.length).toBeGreaterThan(0);
    expect(codex?.options?.map((option) => option.modelId)).toEqual([
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2-codex",
      "gpt-5.2",
      "gpt-5.1-codex-max",
      "gpt-5.1-codex-mini",
    ]);
    expect(codex?.selectedOptionId).toBe("codex-gpt-5-4");
    expect(codex?.options?.[0]).toMatchObject({
      id: "codex-gpt-5-4",
      // Display-form per foolery-b42b: provider+model joined.
      label: "Codex GPT 5.4",
      provider: "Codex",
      model: "GPT",
      version: "5.4",
      modelId: "gpt-5.4",
    });
  });
});

describe("scanForAgents: claude model metadata", () => {
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
          defaultModel: "claude-sonnet-4.5",
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
      model: "Claude",
      flavor: "Sonnet",
      modelId: "claude-sonnet-4-5",
      version: "4.5",
    });
    expect(claude?.options?.length).toBe(6);
    expect(claude?.options?.[0]).toMatchObject({
      id: "claude-claude-sonnet-4-5",
      modelId: "claude-sonnet-4-5",
      label: "Claude Sonnet 4.5",
      provider: "Claude",
      model: "Claude",
      flavor: "Sonnet",
      version: "4.5",
    });
    expect(claude?.options?.[1]).toMatchObject({
      id: "claude-claude-opus-4-7",
      modelId: "claude-opus-4-7",
      label: "Claude Opus 4.7",
      provider: "Claude",
      model: "Claude",
      flavor: "Opus",
      version: "4.7",
    });
    expect(claude?.options?.[2]?.label).toBe("Claude Sonnet 4.6");
  });
});

describe("scanForAgents: gemini model metadata", () => {
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
      model: "Gemini",
      flavor: "Pro",
      modelId: "gemini-2.5-pro",
      version: "2.5",
    });
    expect(gemini?.options?.length).toBe(3);
    expect(gemini?.options?.[0]).toMatchObject({
      id: "gemini-gemini-2-5-pro",
      modelId: "gemini-2.5-pro",
      label: "Gemini Pro 2.5",
      provider: "Gemini",
      model: "Gemini",
      flavor: "Pro",
      version: "2.5",
    });
    expect(gemini?.options?.[1]?.label).toBe("Gemini Flash 2.5");
    expect(gemini?.options?.[2]?.label).toBe("Gemini Flash Lite 2.5");
  });
});

describe("scanForAgents: opencode model metadata", () => {
  it("captures OpenCode model metadata with ids separate from display labels", async () => {
    mockExecCb.mockImplementation(async (cmd: string) => {
      if (cmd === "command -v opencode") {
        return {
          stdout: "/opt/homebrew/bin/opencode\n",
          stderr: "",
        };
      }
      if (cmd === "opencode models") {
        return {
          stdout: [
            "openrouter/anthropic/claude-sonnet-4-5",
            "openrouter/openai/gpt-5-mini",
          ].join("\n"),
          stderr: "",
        };
      }
      throw new Error("not found");
    });

    const agents = await scanForAgents();
    const opencode = agents.find((agent) => agent.id === "opencode");
    expect(opencode).toMatchObject({
      id: "opencode",
      command: "opencode",
      path: "/opt/homebrew/bin/opencode",
      installed: true,
      provider: "OpenCode",
    });
    expect(opencode?.options?.[0]).toMatchObject({
      id: "opencode-openrouter-anthropic-claude-sonnet-4-5",
      modelId: "openrouter/anthropic/claude-sonnet-4-5",
      label: "OpenCode openrouter/anthropic/claude-sonnet-4-5",
      provider: "OpenCode",
      model: "openrouter/anthropic/claude-sonnet-4-5",
    });
    expect(opencode?.options?.[1]).toMatchObject({
      id: "opencode-openrouter-openai-gpt-5-mini",
      modelId: "openrouter/openai/gpt-5-mini",
      label: "OpenCode openrouter/openai/gpt-5-mini",
      provider: "OpenCode",
    });
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
            '    - "claude-opus-4.7"',
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
    expect(copilot?.options?.length).toBe(5);
    const ids = copilot?.options?.map((o) => o.modelId);
    expect(ids).toEqual([
      "claude-opus-4.7",
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
