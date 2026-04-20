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

async function runPartialSelectionWriter(
  scriptName: "setup.sh" | "agent-wizard.sh",
) {
  const homeDir = await mkdtemp(
    join(tmpdir(), "foolery-settings-writer-"),
  );
  createdHomes.push(homeDir);

  const scriptPath = join(
    process.cwd(), "scripts", scriptName,
  );
  await execFileAsync(
    "bash",
    [
      "-lc",
      `
        source "$1"
        REGISTERED_AGENTS=()
        _register_model_agents claude sonnet-4 opus-4
        _kv_set ACTION_MAP take claude-sonnet-4
        _write_settings_toml
      `,
      "bash",
      scriptPath,
    ],
    { env: { ...process.env, HOME: homeDir } },
  );

  const settingsPath = join(
    homeDir, ".config", "foolery", "settings.toml",
  );
  const raw = await readFile(settingsPath, "utf8");
  const parsed = parse(raw) as Record<string, unknown>;
  return { raw, parsed };
}

async function runBundledWorkflowPoolWriter(
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
        REGISTERED_AGENTS=(codex-gpt-5 claude)
        _kv_set AGENT_COMMANDS codex-gpt-5 codex
        _kv_set AGENT_LABELS codex-gpt-5 "OpenAI Codex"
        _kv_set AGENT_MODELS codex-gpt-5 gpt-5
        _kv_set AGENT_COMMANDS claude claude
        _kv_set AGENT_LABELS claude "Claude Code"
        _kv_set DISPATCH dispatch_mode advanced
        _kv_set POOL_AGENT_work_sdlc__autopilot__planning 0 codex-gpt-5
        _kv_set POOL_WEIGHT_work_sdlc__autopilot__planning codex-gpt-5 4
        _kv_set POOL_COUNT work_sdlc__autopilot__planning 1
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

function expectDefaultSettingsOutput(
  raw: string,
  parsed: Record<string, unknown>,
) {
  expect(raw).toContain('dispatchMode = "basic"');
  expect(raw).toContain("maxConcurrentSessions = 5");
  expect(raw).toContain("maxClaimsPerQueueType = 10");
  expect(raw).toContain("[backend]");
  expect(raw).toContain("[defaults]");
  expect(raw).toContain(
    "interactiveSessionTimeoutMinutes = 10",
  );
  expect(raw).toContain("[scopeRefinement]");
  expect(raw).toContain("[pools]");

  expect(parsed).toMatchObject({
    dispatchMode: "basic",
    maxConcurrentSessions: 5,
    maxClaimsPerQueueType: 10,
    actions: {
      take: "codex-gpt-5",
      scene: "claude",
      breakdown: "codex-gpt-5-2",
      scopeRefinement: "",
    },
    backend: { type: "auto" },
    defaults: {
      profileId: "",
      interactiveSessionTimeoutMinutes: 10,
    },
    pools: {
      orchestration: [],
      planning: [],
      plan_review: [],
      implementation: [],
      implementation_review: [],
      shipment: [],
      shipment_review: [],
      scope_refinement: [],
    },
  });

  expect(parsed.scopeRefinement).toHaveProperty("prompt");
  expect(
    (parsed.scopeRefinement as { prompt: string }).prompt,
  ).toContain("{{title}}");

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
}

describe("settings writers", () => {
  it.each(["setup.sh", "agent-wizard.sh"] as const)(
    "writes complete default settings from %s",
    async (scriptName) => {
      const { raw, parsed } = await runWriter(scriptName);
      expectDefaultSettingsOutput(raw, parsed);
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
        scopeRefinement: "",
      });
      expect((parsed.agents as Record<string, unknown>).copilot).not.toHaveProperty(
        "model",
      );
    },
  );

  it.each(["setup.sh", "agent-wizard.sh"] as const)(
    "includes only agents with models, not unselected harnesses in %s",
    async (scriptName) => {
      const { parsed } =
        await runPartialSelectionWriter(scriptName);

      const agents = parsed.agents as
        Record<string, Record<string, string>>;
      expect(Object.keys(agents)).toHaveLength(2);
      expect(agents["claude-sonnet-4"]).toMatchObject({
        command: "claude",
        model: "sonnet-4",
      });
      expect(agents["claude-opus-4"]).toMatchObject({
        command: "claude",
        model: "opus-4",
      });
      expect(agents).not.toHaveProperty("codex");
      expect(agents).not.toHaveProperty("gemini");
    },
  );

  it.each(["setup.sh", "agent-wizard.sh"] as const)(
    "writes bundled workflow target pools in %s",
    async (scriptName) => {
      const { raw, parsed } =
        await runBundledWorkflowPoolWriter(scriptName);

      expect(raw).toContain('dispatchMode = "advanced"');
      expect(raw).toContain("[[pools.work_sdlc__autopilot__planning]]");
      expect(parsed.pools).toMatchObject({
        orchestration: [],
        planning: [],
        plan_review: [],
        implementation: [],
        implementation_review: [],
        shipment: [],
        shipment_review: [],
        scope_refinement: [],
        work_sdlc__autopilot__planning: [
          { agentId: "codex-gpt-5", weight: 4 },
        ],
      });
    },
  );
});
