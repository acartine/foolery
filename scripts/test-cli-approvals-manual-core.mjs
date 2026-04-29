import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parse, stringify } from "smol-toml";

const execFile = promisify(execFileCallback);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export const rootDir = path.resolve(scriptDir, "..");
export const approvalMarker = "FOOLERY APPROVAL REQUIRED";
export const approvalDir = ".approval-validation";
export const defaultPort = Number(process.env.FOOLERY_DEV_PORT ?? 3328);

export const providers = {
  codex: {
    fileName: "codex.txt",
    marker: "FOOLERY_APPROVAL_CONTINUED_CODEX",
    label: "Codex",
  },
  claude: {
    fileName: "claude.txt",
    marker: "FOOLERY_APPROVAL_CONTINUED_CLAUDE",
    label: "Claude Code",
  },
  opencode: {
    fileName: "opencode.txt",
    marker: "FOOLERY_APPROVAL_CONTINUED_OPENCODE",
    label: "OpenCode",
  },
};

export class BlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "BlockedError";
  }
}

export function usage() {
  return `Usage:
  bash scripts/test-cli-approvals-manual.sh [options]

Options:
  --provider <codex|claude|opencode|all>  Provider to validate (default: all)
  --repo <path>                           Knots-backed repo for the session
  --beat-id <id>                          Existing knot id; otherwise create one
  --base-url <url>                        Reuse a running Foolery server
  --port <number>                         Dev server port when starting one
  --pool-step <step>                      Advanced dispatch pool to replace
  --agent-id <id>                         Exact Foolery agent id to select
  --skip-browser                          Skip approvals tab/UI click checks
  --no-config-mutation                    Do not rewrite Foolery settings
  --allow-known-blockers                  Try the run despite source blockers
  --keep-test-dir                         Keep .test-cli-approvals-manual
  --timeout-ms <number>                   Per-wait timeout (default: 180000)
  --dry-helper-checks                     Exercise pure harness checks only
  --help                                  Show this help`;
}

export function parseArgs(argv) {
  const options = {
    provider: process.env.FOOLERY_APPROVAL_PROVIDER ?? "all",
    repo: process.env.FOOLERY_APPROVAL_REPO ?? process.cwd(),
    beatId: process.env.FOOLERY_APPROVAL_BEAT_ID ?? "",
    baseUrl: process.env.FOOLERY_BASE_URL ?? "",
    port: defaultPort,
    poolStep: process.env.FOOLERY_APPROVAL_POOL_STEP ?? "planning",
    agentId: process.env.FOOLERY_APPROVAL_AGENT_ID ?? "",
    skipBrowser: process.env.FOOLERY_APPROVAL_SKIP_BROWSER === "1",
    mutateConfig: process.env.FOOLERY_APPROVAL_NO_CONFIG_MUTATION !== "1",
    allowKnownBlockers:
      process.env.FOOLERY_APPROVAL_ALLOW_KNOWN_BLOCKERS === "1",
    keepTestDir: process.env.FOOLERY_KEEP_APPROVAL_TEST_DIR === "1",
    dryHelperChecks: process.env.FOOLERY_APPROVAL_DRY_HELPER_CHECKS === "1",
    timeoutMs: Number(process.env.FOOLERY_APPROVAL_TIMEOUT_MS ?? 180_000),
    settingsPath:
      process.env.FOOLERY_APPROVAL_SETTINGS_PATH ??
      path.join(os.homedir(), ".config", "foolery", "settings.toml"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };
    if (arg === "--provider") options.provider = next();
    else if (arg === "--repo") options.repo = next();
    else if (arg === "--beat-id") options.beatId = next();
    else if (arg === "--base-url") options.baseUrl = next();
    else if (arg === "--port") options.port = Number(next());
    else if (arg === "--pool-step") options.poolStep = next();
    else if (arg === "--agent-id") options.agentId = next();
    else if (arg === "--settings-path") options.settingsPath = next();
    else if (arg === "--timeout-ms") options.timeoutMs = Number(next());
    else if (arg === "--skip-browser") options.skipBrowser = true;
    else if (arg === "--no-config-mutation") options.mutateConfig = false;
    else if (arg === "--allow-known-blockers") {
      options.allowKnownBlockers = true;
    } else if (arg === "--keep-test-dir") {
      options.keepTestDir = true;
    } else if (arg === "--dry-helper-checks") {
      options.dryHelperChecks = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }
  if (!Number.isFinite(options.port) || options.port <= 0) {
    throw new Error("--port must be a positive number");
  }
  return options;
}

export function providerList(value) {
  if (value === "all") return Object.keys(providers);
  if (providers[value]) return [value];
  throw new Error(
    `Unknown provider '${value}'. Expected codex, claude, opencode, or all.`,
  );
}

export function log(provider, message) {
  const prefix = provider ? `[approvals:${provider}]` : "[approvals]";
  console.log(`${prefix} ${message}`);
}

export async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return "";
    throw error;
  }
}

export async function detectKnownBlocker(provider, options) {
  if (options.allowKnownBlockers) return;
  if (provider === "codex") {
    const source = await readTextIfExists(
      path.join(rootDir, "src/lib/codex-jsonrpc-session.ts"),
    );
    if (
      /params:\s*\{\s*approvalPolicy:\s*"never"\s*\}/u.test(source)
    ) {
      throw new BlockedError(
        'Codex app-server still starts threads with approvalPolicy "never".',
      );
    }
  }
  if (provider === "claude") {
    const source = await readTextIfExists(
      path.join(rootDir, "src/lib/terminal-manager-initial-child-helpers.ts"),
    );
    if (source.includes("--dangerously-skip-permissions")) {
      throw new BlockedError(
        "Claude interactive launch still includes --dangerously-skip-permissions.",
      );
    }
  }
  if (provider === "opencode") {
    const visibilitySource = await readTextIfExists(
      path.join(rootDir, "src/lib/approval-request-visibility.ts"),
    );
    const extractorSource = await readTextIfExists(
      path.join(rootDir, "src/lib/opencode-approval-request.ts"),
    );
    if (!hasOpenCodePermissionExtraction(visibilitySource, extractorSource)) {
      throw new BlockedError(
        "OpenCode permission.asked extraction is not implemented.",
      );
    }
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function providerMatches(provider, id, agent) {
  const haystack = [
    id,
    agent?.vendor,
    agent?.provider,
    agent?.agent_name,
    agent?.command,
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(provider);
}

export function hasOpenCodePermissionExtraction(
  visibilitySource,
  extractorSource,
) {
  if (visibilitySource.includes("permission.asked")) return true;
  const extractsPermissionAsked = extractorSource.includes("permission.asked");
  const exportsExtractor = /\bexport\b/.test(extractorSource);
  return extractsPermissionAsked && exportsExtractor;
}

export async function mutateFoolerySettings(provider, options) {
  if (!options.mutateConfig) {
    log(provider, "Skipping Foolery settings mutation by request.");
    return "caller-configured";
  }

  const raw = await readTextIfExists(options.settingsPath);
  if (!raw) {
    throw new BlockedError(
      `Foolery settings missing at ${options.settingsPath}; configure agents first.`,
    );
  }

  const settings = parse(raw);
  const agents = isObject(settings.agents) ? settings.agents : {};
  const agentId = resolveAgentId(provider, options, agents);
  forceProviderInSettings(settings, provider, agentId, options.poolStep);

  await fs.writeFile(options.settingsPath, stringify(settings));
  await validateFoolerySettings(options.settingsPath);
  log(provider, `Selected Foolery agent ${agentId}.`);
  return agentId;
}

export function forceProviderInSettings(settings, provider, agentId, poolStep) {
  settings.agents = isObject(settings.agents) ? settings.agents : {};
  settings.maxConcurrentSessions = 1;
  if (provider === "claude" || provider === "codex") {
    const agent = settings.agents[agentId];
    if (!isObject(agent)) {
      throw new BlockedError(
        `Selected ${provider} agent is not an object in settings: ${agentId}`,
      );
    }
    agent.approvalMode = "prompt";
  }
  if (settings.dispatchMode === "advanced") {
    settings.pools = isObject(settings.pools) ? settings.pools : {};
    settings.pools[poolStep] = [{ agentId, weight: 1 }];
  } else {
    settings.actions = isObject(settings.actions) ? settings.actions : {};
    settings.actions.take = agentId;
  }
  return settings;
}

function resolveAgentId(provider, options, agents) {
  if (options.agentId) {
    if (!agents[options.agentId]) {
      throw new BlockedError(
        `Configured --agent-id is not present in settings: ${options.agentId}`,
      );
    }
    if (!providerMatches(provider, options.agentId, agents[options.agentId])) {
      throw new BlockedError(
        `Agent ${options.agentId} does not look like provider ${provider}.`,
      );
    }
    return options.agentId;
  }
  const matches = Object.entries(agents)
    .filter(([id, agent]) => providerMatches(provider, id, agent))
    .map(([id]) => id)
    .sort();
  if (matches.length === 0) {
    throw new BlockedError(`No Foolery agent registered for ${provider}.`);
  }
  return matches[0];
}

async function validateFoolerySettings(settingsPath) {
  try {
    await execFile("foolery", ["config", "validate", settingsPath]);
    return;
  } catch (error) {
    if (error && error.code !== "ENOENT") throw error;
  }
  try {
    await execFile(
      "bun",
      ["run", "src/bin/foolery-config.ts", "validate", settingsPath],
      { cwd: rootDir },
    );
  } catch (error) {
    throw new Error(
      `Foolery settings validation failed for ${settingsPath}: ${error.message}`,
    );
  }
}

export async function prepareProviderRun(provider) {
  const token = `${provider}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const runDir = path.join(rootDir, ".test-cli-approvals-manual", token);
  await fs.mkdir(runDir, { recursive: true });
  const env = {};
  if (provider === "opencode") {
    const configDir = path.join(runDir, "opencode-config");
    await fs.mkdir(configDir, { recursive: true });
    const configPath = path.join(configDir, "opencode.json");
    const config = {
      $schema: "https://opencode.ai/config.json",
      permission: { edit: "ask", bash: "ask" },
    };
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    env.OPENCODE_CONFIG = configPath;
  }
  return { token, runDir, env };
}

export async function createHarnessBeat(provider, repo, token) {
  const title = `Approval harness ${provider} ${token}`;
  const description = [
    "Manual approval validation knot.",
    "Do not move this knot to a terminal state during harness execution.",
  ].join(" ");
  await execFile(
    "kno",
    ["-C", repo, "new", title, "-d", description, "--tag", "approval-harness"],
    { maxBuffer: 1024 * 1024 },
  );
  return await findHarnessBeat(repo, title);
}

async function findHarnessBeat(repo, title) {
  const { stdout } = await execFile(
    "kno",
    [
      "-C",
      repo,
      "ls",
      "--tag",
      "approval-harness",
      "--query",
      title,
      "--limit",
      "10",
      "--json",
    ],
    { maxBuffer: 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout);
  const matches = Array.isArray(parsed.data)
    ? parsed.data.filter((beat) => beat?.title === title)
    : [];
  if (matches.length === 0) {
    throw new Error(
      `Could not find created approval harness knot: ${title}`,
    );
  }
  return matches[0].id;
}

export function approvalPrompt(provider, token) {
  const config = providers[provider];
  const targetFile = `${approvalDir}/${config.fileName}`;
  if (provider === "codex") {
    const command = "python3 -c "
      + JSON.stringify(
        "from pathlib import Path; "
        + `p = Path(${JSON.stringify(targetFile)}); `
        + "p.parent.mkdir(exist_ok=True); "
        + `p.write_text(${JSON.stringify(`${token}\n`)})`,
      );
    return [
      "This is a Foolery approval-flow validation run.",
      "Run exactly this shell command from the repository root:",
      command,
      "Do not use apply_patch or direct file editing.",
      `After the file exists, print exactly: ${config.marker} ${token}`,
      "Do not move any knots to terminal states.",
    ].join("\n");
  }
  return [
    "This is a Foolery approval-flow validation run.",
    `Create ${targetFile} with exactly this token: ${token}`,
    "Use a shell or file-editing tool so the CLI must request approval.",
    `After the file exists, print exactly: ${config.marker} ${token}`,
    "Do not move any knots to terminal states.",
  ].join("\n");
}

export async function verifyContinuation(repo, provider, token) {
  const filePath = path.join(repo, approvalDir, providers[provider].fileName);
  const content = await readTextIfExists(filePath);
  if (!content.includes(token)) {
    throw new Error(`Continuation file missing token: ${filePath}`);
  }
}
