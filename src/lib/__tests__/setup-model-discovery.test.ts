import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parse } from "smol-toml";

const execFileAsync = promisify(execFile);
const createdHomes: string[] = [];

async function discoverClaudeModels(
  scriptName: "setup.sh" | "agent-wizard.sh",
): Promise<string[]> {
  const scriptPath = join(process.cwd(), "scripts", scriptName);
  const { stdout } = await execFileAsync("bash", [
    "-lc",
    'source "$1"\n_discover_models claude',
    "bash",
    scriptPath,
  ]);
  return stdout.split("\n").filter(Boolean);
}

async function writeClaudeModel(
  scriptName: "setup.sh" | "agent-wizard.sh",
  model: string,
) {
  const homeDir = await mkdtemp(join(tmpdir(), "foolery-claude-model-"));
  createdHomes.push(homeDir);

  const scriptPath = join(process.cwd(), "scripts", scriptName);
  await execFileAsync(
    "bash",
    [
      "-lc",
      `
        source "$1"
        REGISTERED_AGENTS=()
        _register_model_agents claude "$2"
        _kv_set ACTION_MAP take claude-claude-opus-4-7
        _write_settings_toml
      `,
      "bash",
      scriptPath,
      model,
    ],
    {
      env: { ...process.env, HOME: homeDir },
    },
  );

  const settingsPath = join(homeDir, ".config", "foolery", "settings.toml");
  const raw = await readFile(settingsPath, "utf8");
  return parse(raw) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.all(
    createdHomes.splice(0).map((homeDir) =>
      rm(homeDir, { recursive: true, force: true }),
    ),
  );
});

describe("Claude setup model discovery", () => {
  it.each(["setup.sh", "agent-wizard.sh"] as const)(
    "lists Claude Opus 4.7 as a selectable setup model in %s",
    async (scriptName) => {
      await expect(
        discoverClaudeModels(scriptName),
      ).resolves.toEqual([
        "claude-opus-4.7",
        "claude-sonnet-4.6",
        "claude-opus-4.6",
        "claude-sonnet-4.5",
        "claude-haiku-4.5",
        "claude-opus-4.5",
      ]);
    },
  );

  it.each(["setup.sh", "agent-wizard.sh"] as const)(
    "persists Claude Opus 4.7 when selected in %s",
    async (scriptName) => {
      const parsed = await writeClaudeModel(
        scriptName,
        "claude-opus-4.7",
      );

      expect(parsed.agents).toMatchObject({
        "claude-claude-opus-4-7": {
          command: "claude",
          label: "Claude Code",
          model: "claude-opus-4.7",
        },
      });
      expect(parsed.actions).toMatchObject({
        take: "claude-claude-opus-4-7",
      });
    },
  );
});
