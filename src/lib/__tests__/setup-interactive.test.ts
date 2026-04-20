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
import { bundledDispatchPoolGroups } from "@/lib/settings-dispatch-targets";

const createdHomes: string[] = [];
const groupedDispatchTargets = bundledDispatchPoolGroups()
  .flatMap((group) => group.targets.map((target) => target.id));
const bundledWorkflowTargetCount = groupedDispatchTargets.filter(
  (targetId) => targetId.startsWith("work_sdlc__"),
).length;

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

  // Use bash -c (not -lc) so login-shell profile init does not
  // run and consume piped stdin before the snippet executes.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "bash",
      ["-c", bashSnippet, "bash", scriptPath],
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

    child.stdin?.write(stdinInput);
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
interactiveSessionTimeoutMinutes = 10

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

function fallbackPoolInput(): string {
  return "\n0\n\n\n0\n0\n0\n";
}

function buildSingleTargetOverrideInput(): string {
  const existingCounts = new Map<string, number>([
    ["planning", 2],
    ["implementation", 1],
    ["implementation_review", 1],
  ]);
  const inputTokens = [""];
  for (const targetId of groupedDispatchTargets) {
    if (targetId === "orchestration" || targetId === "scope_refinement") {
      inputTokens.push("0");
      continue;
    }
    if (targetId === "work_sdlc__autopilot__planning") {
      inputTokens.push("2", "1", "5", "0");
      continue;
    }
    const fallbackId = targetId.split("__").at(-1)!;
    inputTokens.push(existingCounts.get(fallbackId) ? "" : "0");
  }
  return `${inputTokens.join("\n")}\n`;
}

function buildBulkApplyInput(): string {
  const inputTokens = ["1", "3", "0", "0"];
  for (let i = 0; i < bundledWorkflowTargetCount; i++) {
    inputTokens.push("");
  }
  return `${inputTokens.join("\n")}\n`;
}

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
        fallbackPoolInput(),
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
    "reconfiguring one bundled workflow target preserves other pools",
    async () => {
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
        buildSingleTargetOverrideInput(),
      );

      const pools = parsed.pools as Record<
        string,
        Array<{ agentId: string; weight: number }>
      >;
      expect(pools["work_sdlc__autopilot__planning"]).toHaveLength(1);
      expect(
        pools["work_sdlc__autopilot__planning"][0],
      ).toMatchObject({
        agentId: "claude-sonnet",
        weight: 5,
      });
      // legacy planning stays intact for untouched bundled targets
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
});

describe("advanced pool add to all", () => {
  it(
    "bulk applies one agent across bundled workflow targets",
    async () => {
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
        buildBulkApplyInput(),
      );

      const pools = parsed.pools as Record<
        string,
        Array<{ agentId: string; weight: number }>
      >;
      expect(
        pools["work_sdlc__autopilot__planning"],
      ).toMatchObject([{ agentId: "claude-sonnet", weight: 3 }]);
      expect(
        pools["work_sdlc__autopilot_with_pr__shipment_review"],
      ).toMatchObject([{ agentId: "claude-sonnet", weight: 3 }]);
      expect(
        pools["work_sdlc__semiauto_no_planning__implementation"],
      ).toMatchObject([{ agentId: "claude-sonnet", weight: 3 }]);
      expect(pools.orchestration).toEqual([]);
      expect(pools.scope_refinement).toEqual([]);
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
