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
        FOUND_AGENTS=(codex claude)
        _kv_set AGENT_MODELS codex gpt-5
        _kv_set ACTION_MAP take codex
        _kv_set ACTION_MAP scene claude
        _kv_set ACTION_MAP breakdown codex
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
          take: "codex",
          scene: "claude",
          breakdown: "codex",
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
        codex: { command: "codex", label: "OpenAI Codex", model: "gpt-5" },
        claude: { command: "claude", label: "Claude Code" },
      });
    },
  );
});
