import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parse } from "smol-toml";

const execFileAsync = promisify(execFile);
const createdHomes: string[] = [];

/** Seed a settings.toml file, then run a bash snippet that
 *  sources the script, calls _read_settings_toml, optionally
 *  adds new agents, and writes the result. */
async function runAdditive(
  scriptName: "setup.sh" | "agent-wizard.sh",
  seedToml: string,
  bashSnippet: string,
) {
  const homeDir = await mkdtemp(
    join(tmpdir(), "foolery-additive-"),
  );
  createdHomes.push(homeDir);

  const configDir = join(homeDir, ".config", "foolery");
  await mkdir(configDir, { recursive: true });
  const settingsPath = join(configDir, "settings.toml");
  await writeFile(settingsPath, seedToml, "utf8");

  const scriptPath = join(
    process.cwd(),
    "scripts",
    scriptName,
  );
  await execFileAsync(
    "bash",
    ["-lc", bashSnippet, "bash", scriptPath],
    { env: { ...process.env, HOME: homeDir } },
  );

  const raw = await readFile(settingsPath, "utf8");
  const parsed = parse(raw) as Record<string, unknown>;
  return { raw, parsed, homeDir };
}

afterEach(async () => {
  await Promise.all(
    createdHomes
      .splice(0)
      .map((h) => rm(h, { recursive: true, force: true })),
  );
});

const SEED_TOML = `\
dispatchMode = "basic"
maxConcurrentSessions = 8
maxClaimsPerQueueType = 15
terminalLightTheme = true

[agents.claude-sonnet]
command = "claude"
label = "Claude Code"
model = "sonnet"
agent_type = "cli"
vendor = "claude"
provider = "Claude"
agent_name = "Claude"
lease_model = "sonnet/claude"
flavor = "sonnet"
version = "4.6"

[agents.codex-gpt-5]
command = "codex"
label = "OpenAI Codex"
model = "gpt-5"

[actions]
take = "claude-sonnet"
scene = "codex-gpt-5"
breakdown = "claude-sonnet"
scopeRefinement = "claude-sonnet"

[backend]
type = "knots"

[defaults]
profileId = "autopilot"
interactiveSessionTimeoutMinutes = 45

[scopeRefinement]
prompt = """
Custom scope prompt here.
"""

[pools]
planning = []
plan_review = []
implementation = []
implementation_review = []
shipment = []
shipment_review = []
scope_refinement = []
`;

describe("additive TOML reader", () => {
    it.each(["setup.sh", "agent-wizard.sh"] as const)(
      "reads and round-trips existing config from %s",
      async (scriptName) => {
        const snippet = `
          source "$1"
          _read_settings_toml "\$HOME/.config/foolery/settings.toml"
          _write_settings_toml
        `;
        const { parsed } = await runAdditive(
          scriptName,
          SEED_TOML,
          snippet,
        );

        expect(parsed).toMatchObject({
          dispatchMode: "basic",
          maxConcurrentSessions: 8,
          maxClaimsPerQueueType: 15,
          terminalLightTheme: true,
        });

        const agents = parsed.agents as Record<
          string,
          Record<string, string>
        >;
        expect(agents["claude-sonnet"]).toMatchObject({
          command: "claude",
          label: "Claude Code",
          model: "sonnet",
          agent_type: "cli",
          vendor: "claude",
          provider: "Claude",
          agent_name: "Claude",
          lease_model: "sonnet/claude",
          flavor: "sonnet",
          version: "4.6",
        });
        expect(agents["codex-gpt-5"]).toMatchObject({
          command: "codex",
          label: "OpenAI Codex",
          model: "gpt-5",
        });

        expect(parsed.actions).toMatchObject({
          take: "claude-sonnet",
          scene: "codex-gpt-5",
          breakdown: "claude-sonnet",
          scopeRefinement: "claude-sonnet",
        });

        expect(parsed.backend).toMatchObject({
          type: "knots",
        });
        expect(parsed.defaults).toMatchObject({
          profileId: "autopilot",
          interactiveSessionTimeoutMinutes: 45,
        });
      },
    );
});

describe("additive agent registration", () => {
    it.each(["setup.sh", "agent-wizard.sh"] as const)(
      "preserves existing agents when adding a new one in %s",
      async (scriptName) => {
        const snippet = `
          source "$1"
          _read_settings_toml "\$HOME/.config/foolery/settings.toml"
          _register_agent_entry gemini-pro gemini "Google Gemini" gemini-2.5-pro
          _write_settings_toml
        `;
        const { parsed } = await runAdditive(
          scriptName,
          SEED_TOML,
          snippet,
        );

        const agents = parsed.agents as Record<
          string,
          Record<string, string>
        >;

        // Existing agents preserved
        expect(agents["claude-sonnet"]).toMatchObject({
          command: "claude",
          model: "sonnet",
          agent_type: "cli",
          vendor: "claude",
        });
        expect(agents["codex-gpt-5"]).toMatchObject({
          command: "codex",
          model: "gpt-5",
        });

        // New agent added
        expect(agents["gemini-pro"]).toMatchObject({
          command: "gemini",
          label: "Google Gemini",
          model: "gemini-2.5-pro",
        });

        // All three agents present
        expect(Object.keys(agents)).toHaveLength(3);
      },
    );

    it.each(["setup.sh", "agent-wizard.sh"] as const)(
      "preserves action mappings when adding agents in %s",
      async (scriptName) => {
        const snippet = `
          source "$1"
          _read_settings_toml "\$HOME/.config/foolery/settings.toml"
          _register_agent_entry gemini-pro gemini "Google Gemini" gemini-2.5-pro
          _write_settings_toml
        `;
        const { parsed } = await runAdditive(
          scriptName,
          SEED_TOML,
          snippet,
        );

        // Action mappings unchanged
        expect(parsed.actions).toMatchObject({
          take: "claude-sonnet",
          scene: "codex-gpt-5",
          breakdown: "claude-sonnet",
          scopeRefinement: "claude-sonnet",
        });
      },
    );
});

describe("additive scalar preservation", () => {
    it.each(["setup.sh", "agent-wizard.sh"] as const)(
      "preserves backend.type and defaults.profileId in %s",
      async (scriptName) => {
        const snippet = `
          source "$1"
          _read_settings_toml "\$HOME/.config/foolery/settings.toml"
          _write_settings_toml
        `;
        const { parsed } = await runAdditive(
          scriptName,
          SEED_TOML,
          snippet,
        );

        expect(parsed.backend).toMatchObject({
          type: "knots",
        });
        expect(parsed.defaults).toMatchObject({
          profileId: "autopilot",
          interactiveSessionTimeoutMinutes: 45,
        });
      },
    );

    it.each(["setup.sh", "agent-wizard.sh"] as const)(
      "preserves terminalLightTheme in %s",
      async (scriptName) => {
        const snippet = `
          source "$1"
          _read_settings_toml "\$HOME/.config/foolery/settings.toml"
          _write_settings_toml
        `;
        const { parsed } = await runAdditive(
          scriptName,
          SEED_TOML,
          snippet,
        );

        expect(parsed.terminalLightTheme).toBe(true);
      },
    );

    it.each(["setup.sh", "agent-wizard.sh"] as const)(
      "preserves custom sessions and claims values in %s",
      async (scriptName) => {
        const snippet = `
          source "$1"
          _read_settings_toml "\$HOME/.config/foolery/settings.toml"
          _write_settings_toml
        `;
        const { parsed } = await runAdditive(
          scriptName,
          SEED_TOML,
          snippet,
        );

        expect(parsed.maxConcurrentSessions).toBe(8);
        expect(parsed.maxClaimsPerQueueType).toBe(15);
      },
    );
});

describe("additive no-existing-file fallback", () => {
    it.each(["setup.sh", "agent-wizard.sh"] as const)(
      "works from scratch when no settings.toml exists in %s",
      async (scriptName) => {
        const homeDir = await mkdtemp(
          join(tmpdir(), "foolery-additive-"),
        );
        createdHomes.push(homeDir);

        const scriptPath = join(
          process.cwd(),
          "scripts",
          scriptName,
        );
        await execFileAsync(
          "bash",
          [
            "-lc",
            `
              source "$1"
              _read_settings_toml "\$HOME/.config/foolery/settings.toml"
              REGISTERED_AGENTS=()
              _register_agent_entry claude claude "Claude Code" sonnet
              _kv_set ACTION_MAP take claude
              _write_settings_toml
            `,
            "bash",
            scriptPath,
          ],
          { env: { ...process.env, HOME: homeDir } },
        );

        const settingsPath = join(
          homeDir,
          ".config",
          "foolery",
          "settings.toml",
        );
        const raw = await readFile(settingsPath, "utf8");
        const parsed = parse(raw) as Record<string, unknown>;

        expect(parsed).toMatchObject({
          dispatchMode: "basic",
          maxConcurrentSessions: 5,
          maxClaimsPerQueueType: 10,
        });

        const agents = parsed.agents as Record<
          string,
          Record<string, string>
        >;
        expect(agents.claude).toMatchObject({
          command: "claude",
          model: "sonnet",
        });
      },
    );
});

describe("additive advanced pools round-trip", () => {
    it.each(["setup.sh", "agent-wizard.sh"] as const)(
      "preserves pool entries through read-write in %s",
      async (scriptName) => {
      const poolSeed = `\
dispatchMode = "advanced"
maxConcurrentSessions = 5
maxClaimsPerQueueType = 10

[agents.claude-sonnet]
command = "claude"
label = "Claude Code"
model = "sonnet"

[agents.codex-gpt-5]
command = "codex"
label = "OpenAI Codex"
model = "gpt-5"

[actions]
take = ""
scene = ""
breakdown = ""
scopeRefinement = ""

[backend]
type = "auto"

[defaults]
profileId = ""
interactiveSessionTimeoutMinutes = 10

[scopeRefinement]
prompt = """
test
"""

[pools]
plan_review = []
shipment = []
shipment_review = []
scope_refinement = []

[[pools.planning]]
agentId = "claude-sonnet"
weight = 3

[[pools.planning]]
agentId = "codex-gpt-5"
weight = 1

[[pools.implementation]]
agentId = "claude-sonnet"
weight = 2

[[pools.implementation_review]]
agentId = "codex-gpt-5"
weight = 1
`;
      const snippet = `
        source "$1"
        _read_settings_toml "\$HOME/.config/foolery/settings.toml"
        _write_settings_toml
      `;
      const { parsed } = await runAdditive(
        scriptName,
        poolSeed,
        snippet,
      );

      expect(parsed.dispatchMode).toBe("advanced");

      const pools = parsed.pools as Record<
        string,
        Array<{ agentId: string; weight: number }>
      >;
      expect(pools.planning).toHaveLength(2);
      expect(pools.planning[0]).toMatchObject({
        agentId: "claude-sonnet",
        weight: 3,
      });
      expect(pools.planning[1]).toMatchObject({
        agentId: "codex-gpt-5",
        weight: 1,
      });
      expect(pools.implementation).toHaveLength(1);
      expect(pools.implementation[0]).toMatchObject({
        agentId: "claude-sonnet",
        weight: 2,
      });
      expect(pools.implementation_review).toHaveLength(1);
      expect(pools.plan_review).toHaveLength(0);
    });
});

describe("scope prompt round-trip stability", () => {
    it.each(["setup.sh", "agent-wizard.sh"] as const)(
      "preserves scope prompt without adding newlines in %s",
      async (scriptName) => {
        const snippet = `
          source "$1"
          _read_settings_toml "\$HOME/.config/foolery/settings.toml"
          _write_settings_toml
        `;
        // Round-trip 1
        const { parsed: first, homeDir } = await runAdditive(
          scriptName,
          SEED_TOML,
          snippet,
        );
        const firstPrompt = (
          first.scopeRefinement as { prompt: string }
        ).prompt;

        // Round-trip 2 — re-read the output from round-trip 1
        const settingsPath = join(
          homeDir,
          ".config",
          "foolery",
          "settings.toml",
        );
        const secondSeed = await readFile(
          settingsPath,
          "utf8",
        );
        const { parsed: second } = await runAdditive(
          scriptName,
          secondSeed,
          snippet,
        );
        const secondPrompt = (
          second.scopeRefinement as { prompt: string }
        ).prompt;

        expect(firstPrompt).toBe(secondPrompt);
        expect(firstPrompt).not.toMatch(/^\n/);
      },
    );
});

describe("additive metadata fields", () => {
    it.each(["setup.sh", "agent-wizard.sh"] as const)(
      "emits all agent metadata fields in %s",
      async (scriptName) => {
        const snippet = `
          source "$1"
          _read_settings_toml "\$HOME/.config/foolery/settings.toml"
          _write_settings_toml
        `;
        const { parsed } = await runAdditive(
          scriptName,
          SEED_TOML,
          snippet,
        );

        const agents = parsed.agents as Record<
          string,
          Record<string, string>
        >;
        const claude = agents["claude-sonnet"];
        expect(claude.agent_type).toBe("cli");
        expect(claude.vendor).toBe("claude");
        expect(claude.provider).toBe("Claude");
        expect(claude.agent_name).toBe("Claude");
        expect(claude.lease_model).toBe("sonnet/claude");
        expect(claude.flavor).toBe("sonnet");
        expect(claude.version).toBe("4.6");
      },
    );
});
