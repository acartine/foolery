import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parse } from "smol-toml";

const execFileAsync = promisify(execFile);
const createdHomes: string[] = [];

async function runWriter(scriptName: "setup.sh" | "agent-wizard.sh") {
  const homeDir = await mkdtemp(join(tmpdir(), "foolery-settings-writer-"));
  createdHomes.push(homeDir);

  const scriptPath = join(process.cwd(), "scripts", scriptName);
  await execFileAsync(
    "bash",
    [
      "-lc",
      `
        source "$1"
        REGISTERED_AGENTS=(
          codex-gpt-5
          codex-gpt-5-2
          claude
        )
        _kv_set AGENT_COMMANDS codex-gpt-5 codex
        _kv_set AGENT_LABELS codex-gpt-5 "OpenAI Codex"
        _kv_set AGENT_MODELS codex-gpt-5 gpt-5
        _kv_set AGENT_COMMANDS codex-gpt-5-2 codex
        _kv_set AGENT_LABELS codex-gpt-5-2 "OpenAI Codex"
        _kv_set AGENT_MODELS codex-gpt-5-2 gpt-5.2
        _kv_set AGENT_COMMANDS claude claude
        _kv_set AGENT_LABELS claude "Claude Code"
        _kv_set ACTION_MAP take codex-gpt-5
        _kv_set ACTION_MAP scene claude
        _kv_set ACTION_MAP breakdown codex-gpt-5-2
        _write_settings_toml
      `,
      "bash",
      scriptPath,
    ],
    {
      env: { ...process.env, HOME: homeDir },
    },
  );

  const settingsPath = join(homeDir, ".config", "foolery", "settings.toml");
  const raw = await readFile(settingsPath, "utf8");
  const parsed = parse(raw) as Record<string, unknown>;
  return { raw, parsed };
}

async function runZeroSelectionWriter(
  scriptName: "setup.sh" | "agent-wizard.sh",
) {
  const homeDir = await mkdtemp(join(tmpdir(), "foolery-settings-writer-"));
  createdHomes.push(homeDir);

  const scriptPath = join(process.cwd(), "scripts", scriptName);
  await execFileAsync(
    "bash",
    [
      "-lc",
      `
        source "$1"
        REGISTERED_AGENTS=()
        _register_model_agents copilot
        _kv_set ACTION_MAP take copilot
        _kv_set ACTION_MAP scene copilot
        _kv_set ACTION_MAP breakdown copilot
        _write_settings_toml
      `,
      "bash",
      scriptPath,
    ],
    {
      env: { ...process.env, HOME: homeDir },
    },
  );

  const settingsPath = join(homeDir, ".config", "foolery", "settings.toml");
  const raw = await readFile(settingsPath, "utf8");
  const parsed = parse(raw) as Record<string, unknown>;
  return { raw, parsed };
}

afterEach(async () => {
  await Promise.all(
    createdHomes.splice(0).map((homeDir) =>
      rm(homeDir, { recursive: true, force: true }),
    ),
  );
});

describe("settings writers", () => {
  it.each(["setup.sh", "agent-wizard.sh"] as const)(
    "writes complete default settings from %s",
    async (scriptName) => {
      const { raw, parsed } = await runWriter(scriptName);

      expect(raw.startsWith('dispatchMode = "basic"\n\n')).toBe(true);
      expect(raw).toContain("[backend]");
      expect(raw).toContain("[defaults]");
      expect(raw).toContain("[pools]");

      expect(parsed).toMatchObject({
        dispatchMode: "basic",
        actions: {
          take: "codex-gpt-5",
          scene: "claude",
          breakdown: "codex-gpt-5-2",
        },
        backend: { type: "auto" },
        defaults: { profileId: "" },
        pools: {
          planning: [],
          plan_review: [],
          implementation: [],
          implementation_review: [],
          shipment: [],
          shipment_review: [],
        },
      });

      expect(parsed.agents).toMatchObject({
        "codex-gpt-5": {
          command: "codex",
          label: "OpenAI Codex",
          model: "gpt-5",
        },
        "codex-gpt-5-2": {
          command: "codex",
          label: "OpenAI Codex",
          model: "gpt-5.2",
        },
        claude: { command: "claude", label: "Claude Code" },
      });
    },
  );

  it.each(["setup.sh", "agent-wizard.sh"] as const)(
    "keeps the base cli entry when no model is selected in %s",
    async (scriptName) => {
      const { parsed } = await runZeroSelectionWriter(scriptName);

      expect(parsed.agents).toMatchObject({
        copilot: {
          command: "copilot",
          label: "GitHub Copilot",
        },
      });
      expect(parsed.actions).toMatchObject({
        take: "copilot",
        scene: "copilot",
        breakdown: "copilot",
      });
      expect((parsed.agents as Record<string, unknown>).copilot).not.toHaveProperty(
        "model",
      );
    },
  );
});
