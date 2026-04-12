import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";

const createdHomes: string[] = [];

/**
 * Run a bash snippet with piped stdin input and _SETUP_INPUT
 * pointing to /dev/stdin so interactive prompts read from the
 * pipe instead of /dev/tty.  _SETUP_OUTPUT is /dev/null to
 * suppress menu display.
 */
async function runInteractive(
  scriptName: "setup.sh" | "agent-wizard.sh",
  seedToml: string,
  bashSnippet: string,
  stdinInput: string,
): Promise<{
  raw: string;
  parsed: Record<string, unknown>;
  homeDir: string;
}> {
  const homeDir = await mkdtemp(
    join(tmpdir(), "foolery-interactive-"),
  );
  createdHomes.push(homeDir);

  const configDir = join(
    homeDir,
    ".config",
    "foolery",
  );
  await mkdir(configDir, { recursive: true });
  const settingsPath = join(
    configDir,
    "settings.toml",
  );
  await writeFile(settingsPath, seedToml, "utf8");

  const scriptPath = join(
    process.cwd(),
    "scripts",
    scriptName,
  );

  // Write stdin input to a file so reads work reliably across
  // all platforms (avoids /dev/stdin behaviour differences
  // between macOS and Linux bash versions).
  const inputFile = join(homeDir, "_test_input.txt");
  await writeFile(inputFile, stdinInput, "utf8");

  // Prepend `exec < inputFile` so fd 0 becomes the file;
  // _SETUP_INPUT=/dev/stdin then reads sequentially from it.
  const wrappedSnippet = `exec < ${JSON.stringify(inputFile)}
${bashSnippet}`;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "bash",
      ["-c", wrappedSnippet, "bash", scriptPath],
      {
        env: {
          ...process.env,
          HOME: homeDir,
          _SETUP_INPUT: "/dev/stdin",
          _SETUP_OUTPUT: "/dev/null",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    child.stdin?.end();

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `bash exited ${code}: ${stderr}`,
          ),
        );
      }
    });
    child.on("error", reject);
  });

  const raw = await readFile(settingsPath, "utf8");
  const parsed = parse(raw) as Record<
    string,
    unknown
  >;
  return { raw, parsed, homeDir };
}

afterEach(async () => {
  await Promise.all(
    createdHomes
      .splice(0)
      .map((h) =>
        rm(h, { recursive: true, force: true }),
      ),
  );
});

const SEED_BASIC = `\
dispatchMode = "basic"
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
take = "claude-sonnet"
scene = "codex-gpt-5"
breakdown = "claude-sonnet"
scopeRefinement = "claude-sonnet"

[backend]
type = "auto"

[defaults]
profileId = ""

[scopeRefinement]
prompt = """
test prompt
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

const SEED_ADVANCED = `\
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

describe("basic dispatch keep-by-default", () => {
  it(
    "pressing Enter preserves current action mappings",
    async () => {
      // Four Enter presses = accept default for each
      // of the 4 action choices (take, scene,
      // breakdown, scopeRefinement).
      const snippet = `
        source "$1"
        _read_settings_toml \
          "\$HOME/.config/foolery/settings.toml"
        _prompt_action_mappings
        _write_settings_toml
      `;
      const { parsed } = await runInteractive(
        "setup.sh",
        SEED_BASIC,
        snippet,
        "\n\n\n\n",
      );

      expect(parsed.actions).toMatchObject({
        take: "claude-sonnet",
        scene: "codex-gpt-5",
        breakdown: "claude-sonnet",
        scopeRefinement: "claude-sonnet",
      });
    },
  );

  it(
    "changing one mapping preserves the others",
    async () => {
      // First action (take): pick agent 2 (codex)
      // Remaining three: press Enter to keep.
      const snippet = `
        source "$1"
        _read_settings_toml \
          "\$HOME/.config/foolery/settings.toml"
        _prompt_action_mappings
        _write_settings_toml
      `;
      const { parsed } = await runInteractive(
        "setup.sh",
        SEED_BASIC,
        snippet,
        "2\n\n\n\n",
      );

      expect(parsed.actions).toMatchObject({
        take: "codex-gpt-5",
        scene: "codex-gpt-5",
        breakdown: "claude-sonnet",
        scopeRefinement: "claude-sonnet",
      });
    },
  );
});

describe("advanced pool keep-by-default", () => {
  it(
    "pressing Enter keeps all existing pools",
    async () => {
      // For each of the 7 pool steps:
      //   - 4 steps have existing entries → press
      //     Enter (default=1=Keep current)
      //   - 3 steps are empty → no keep/reconfig
      //     prompt, goes to add-agent; press 0 to
      //     skip
      // Order: planning(has), plan_review(empty),
      //   implementation(has), impl_review(has),
      //   shipment(empty), ship_review(empty),
      //   scope_refinement(empty)
      const snippet = `
        source "$1"
        _read_settings_toml \
          "\$HOME/.config/foolery/settings.toml"
        _prompt_pool_config
        _write_settings_toml
      `;
      const { parsed } = await runInteractive(
        "setup.sh",
        SEED_ADVANCED,
        snippet,
        "\n0\n\n\n0\n0\n0\n",
      );

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
      expect(
        pools.implementation_review,
      ).toHaveLength(1);
    },
  );

  it(
    "reconfiguring one pool preserves others",
    async () => {
      // planning: choose "2" (Reconfigure), then add
      //   agent 1 with weight 5, then 0 to finish
      // plan_review(empty): 0
      // implementation: Enter (keep)
      // impl_review: Enter (keep)
      // shipment(empty): 0
      // ship_review(empty): 0
      // scope_refinement(empty): 0
      const snippet = `
        source "$1"
        _read_settings_toml \
          "\$HOME/.config/foolery/settings.toml"
        _prompt_pool_config
        _write_settings_toml
      `;
      const { parsed } = await runInteractive(
        "setup.sh",
        SEED_ADVANCED,
        snippet,
        "2\n1\n5\n0\n0\n\n\n0\n0\n0\n",
      );

      const pools = parsed.pools as Record<
        string,
        Array<{ agentId: string; weight: number }>
      >;
      // planning was reconfigured
      expect(pools.planning).toHaveLength(1);
      expect(pools.planning[0]).toMatchObject({
        agentId: "claude-sonnet",
        weight: 5,
      });
      // implementation kept
      expect(pools.implementation).toHaveLength(1);
      expect(pools.implementation[0]).toMatchObject({
        agentId: "claude-sonnet",
        weight: 2,
      });
      // impl_review kept
      expect(
        pools.implementation_review,
      ).toHaveLength(1);
    },
  );
});

describe("dispatch wizard mode default", () => {
  it(
    "defaults to current dispatch mode on Enter",
    async () => {
      // Dispatch wizard: Enter (default basic),
      //   then 4 Enter for action mappings.
      const snippet = `
        source "$1"
        _read_settings_toml \
          "\$HOME/.config/foolery/settings.toml"
        _dispatch_wizard
        _write_settings_toml
      `;
      const { parsed } = await runInteractive(
        "setup.sh",
        SEED_BASIC,
        snippet,
        "\n\n\n\n\n",
      );

      expect(parsed.dispatchMode).toBe("basic");
      expect(parsed.actions).toMatchObject({
        take: "claude-sonnet",
        scene: "codex-gpt-5",
        breakdown: "claude-sonnet",
        scopeRefinement: "claude-sonnet",
      });
    },
  );
});
