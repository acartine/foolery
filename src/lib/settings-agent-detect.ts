/**
 * Agent config detection, model readers, and scan-for-agents.
 *
 * Extracted from settings-agent-scan.ts to stay under 500 lines.
 */
import { parse } from "smol-toml";
import { readFile, readdir, stat } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ScannedAgent, ScannedAgentOption } from "@/lib/types";
import {
  normalizeAgentIdentity,
  providerLabel,
} from "@/lib/agent-identity";
import { loadAgentModelCatalog } from "@/lib/settings-agent-scan";
import {
  buildAgentOptionId,
  formatAgentOptionLabel,
} from "@/lib/agent-identity";

const execAsync = promisify(exec);

const CODEX_CONFIG_FILE = join(homedir(), ".codex", "config.toml");
const CLAUDE_SETTINGS_FILE = join(
  homedir(),
  ".claude",
  "settings.json",
);
const GEMINI_SETTINGS_FILE = join(
  homedir(),
  ".gemini",
  "settings.json",
);
const GEMINI_TMP_ROOT = join(homedir(), ".gemini", "tmp");

// ── Config readers ───────────────────────────────────────────

interface ScannableAgent {
  id: string;
  command: string;
}

const SCANNABLE_AGENTS: readonly ScannableAgent[] = [
  { id: "claude", command: "claude" },
  { id: "codex", command: "codex" },
  { id: "gemini", command: "gemini" },
  { id: "opencode", command: "opencode" },
] as const;

async function readCodexConfiguredModel(): Promise<
  string | undefined
> {
  try {
    const raw = await readFile(CODEX_CONFIG_FILE, "utf-8");
    const parsed = parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      "model" in parsed &&
      typeof parsed.model === "string"
    ) {
      return parsed.model;
    }
  } catch {
    // ignore missing config
  }
  return undefined;
}

function findStringField(
  value: unknown,
  keys: ReadonlySet<string>,
): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findStringField(entry, keys);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (
      keys.has(key) &&
      typeof entry === "string" &&
      entry.trim()
    ) {
      return entry.trim();
    }
    const nested = findStringField(entry, keys);
    if (nested) return nested;
  }
  return undefined;
}

async function readClaudeConfiguredModel(): Promise<
  string | undefined
> {
  try {
    const raw = await readFile(CLAUDE_SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return findStringField(
      parsed,
      new Set(["model", "defaultModel", "primaryModel"]),
    );
  } catch {
    return undefined;
  }
}

async function readGeminiConfiguredModel(): Promise<
  string | undefined
> {
  try {
    const raw = await readFile(GEMINI_SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const direct = findStringField(
      parsed,
      new Set(["model", "defaultModel", "selectedModel"]),
    );
    if (direct) return direct;
  } catch {
    // ignore
  }
  try {
    return await scanGeminiTmpForModel();
  } catch {
    return undefined;
  }
}

async function scanGeminiTmpForModel(): Promise<
  string | undefined
> {
  const roots = await readdir(GEMINI_TMP_ROOT);
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const root of roots) {
    const chatsDir = join(GEMINI_TMP_ROOT, root, "chats");
    let entries: string[];
    try {
      entries = await readdir(chatsDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const filePath = join(chatsDir, entry);
      try {
        const details = await stat(filePath);
        if (!newest || details.mtimeMs > newest.mtimeMs) {
          newest = {
            path: filePath,
            mtimeMs: details.mtimeMs,
          };
        }
      } catch {
        // ignore
      }
    }
  }

  if (!newest) return undefined;
  const raw = await readFile(newest.path, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  return findStringField(
    parsed,
    new Set(["model", "modelId"]),
  );
}

async function readOpenCodeModels(): Promise<
  ScannedAgentOption[]
> {
  try {
    const { stdout } = await execAsync("opencode models", {
      timeout: 10_000,
    });
    const lines = stdout.trim().split("\n").filter(Boolean);
    return lines.map((line) => {
      const modelId = line.trim();
      const slug = modelId
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-");
      return {
        id: `opencode-${slug}`,
        label: modelId,
        provider: "OpenCode",
        model: modelId,
        modelId,
      };
    });
  } catch {
    return [];
  }
}

// ── Agent metadata inspection ────────────────────────────────

async function resolveInstalledAgentCommand(
  agent: ScannableAgent,
): Promise<{ command: string; path: string } | null> {
  try {
    const { stdout } = await execAsync(
      `command -v ${agent.command}`,
    );
    const path = stdout.trim();
    if (path) return { command: agent.command, path };
  } catch {
    return null;
  }
  return null;
}

type AgentMetadata = Pick<
  ScannedAgent,
  "provider" | "model" | "flavor" | "version" | "modelId"
>;

async function inspectInstalledAgentMetadata(
  agent: ScannableAgent,
  resolvedCommand: string,
): Promise<AgentMetadata> {
  const provider = providerLabel(undefined, resolvedCommand);

  if (
    agent.id === "codex" ||
    agent.id === "claude" ||
    agent.id === "gemini"
  ) {
    return inspectStandardAgent(
      agent.id,
      resolvedCommand,
      provider,
    );
  }

  if (agent.id === "opencode") {
    const models = await readOpenCodeModels();
    const first = models[0];
    return {
      provider: "OpenCode",
      ...(first?.model ? { model: first.model } : {}),
      ...(first?.modelId ? { modelId: first.modelId } : {}),
    };
  }

  return normalizedMetadata(resolvedCommand, provider);
}

async function inspectStandardAgent(
  agentId: string,
  resolvedCommand: string,
  provider: string | undefined,
): Promise<AgentMetadata> {
  let modelId: string | undefined;
  if (agentId === "codex") {
    modelId = await readCodexConfiguredModel();
  } else if (agentId === "claude") {
    modelId = await readClaudeConfiguredModel();
  } else if (agentId === "gemini") {
    modelId = await readGeminiConfiguredModel();
  }

  const normalized = normalizeAgentIdentity({
    command: resolvedCommand,
    provider,
    model: modelId,
  });
  return {
    ...(normalized.provider
      ? { provider: normalized.provider }
      : {}),
    ...(normalized.model ? { model: normalized.model } : {}),
    ...(normalized.flavor
      ? { flavor: normalized.flavor }
      : {}),
    ...(normalized.version
      ? { version: normalized.version }
      : {}),
    ...(modelId ? { modelId } : {}),
  };
}

function normalizedMetadata(
  resolvedCommand: string,
  provider: string | undefined,
): AgentMetadata {
  const normalized = normalizeAgentIdentity({
    command: resolvedCommand,
    provider,
  });
  return {
    ...(normalized.provider
      ? { provider: normalized.provider }
      : {}),
    ...(normalized.model ? { model: normalized.model } : {}),
    ...(normalized.flavor
      ? { flavor: normalized.flavor }
      : {}),
    ...(normalized.version
      ? { version: normalized.version }
      : {}),
  };
}

// ── Import options builder ───────────────────────────────────

function dedupeScannedOptions(
  agentId: string,
  options: Array<{
    provider?: string;
    model?: string;
    flavor?: string;
    version?: string;
    modelId?: string;
  }>,
): ScannedAgent["options"] {
  const seen = new Set<string>();
  const deduped: NonNullable<ScannedAgent["options"]> = [];
  for (const option of options) {
    const id = buildAgentOptionId(agentId, option);
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push({
      ...option,
      id,
      label: formatAgentOptionLabel(option),
    });
  }
  return deduped;
}

async function buildAgentImportOptions(
  agentId: string,
  detected: Pick<
    ScannedAgent,
    "provider" | "model" | "flavor" | "version" | "modelId"
  >,
): Promise<ScannedAgent["options"]> {
  const catalog = await loadAgentModelCatalog();
  const provider = providerLabel(detected.provider, agentId);
  const catalogOptions = (catalog[agentId] ?? []).map((o) => ({
    provider,
    ...o,
  }));
  const detectedOption = detected.modelId
    ? [
        {
          provider,
          ...(detected.model ? { model: detected.model } : {}),
          ...(detected.flavor
            ? { flavor: detected.flavor }
            : {}),
          ...(detected.version
            ? { version: detected.version }
            : {}),
          modelId: detected.modelId,
        },
      ]
    : [];

  const matchedIdx = detected.modelId
    ? catalogOptions.findIndex(
        (o) => o.modelId === detected.modelId,
      )
    : -1;

  if (matchedIdx >= 0) {
    const matched = catalogOptions[matchedIdx]!;
    const ordered = [
      matched,
      ...catalogOptions.filter((_, i) => i !== matchedIdx),
    ];
    return dedupeScannedOptions(agentId, ordered);
  }

  if (detectedOption.length > 0) {
    return dedupeScannedOptions(agentId, [
      ...detectedOption,
      ...catalogOptions,
    ]);
  }

  if (catalogOptions.length > 0) {
    return dedupeScannedOptions(agentId, catalogOptions);
  }

  if (provider) {
    return dedupeScannedOptions(agentId, [{ provider }]);
  }

  return [];
}

// ── Public: scanForAgents ────────────────────────────────────

/** Scans PATH for known agent CLIs. */
export async function scanForAgents(): Promise<ScannedAgent[]> {
  return Promise.all(
    SCANNABLE_AGENTS.map(async (agent): Promise<ScannedAgent> => {
      const installed =
        await resolveInstalledAgentCommand(agent);
      if (installed) {
        return buildInstalledAgent(agent, installed);
      }
      const provider = providerLabel(
        undefined,
        agent.command,
      );
      const options = await buildAgentImportOptions(agent.id, {
        provider,
      });
      return {
        id: agent.id,
        command: agent.command,
        path: "",
        installed: false,
        ...(provider ? { provider } : {}),
        options,
      };
    }),
  );
}

async function buildInstalledAgent(
  agent: ScannableAgent,
  installed: { command: string; path: string },
): Promise<ScannedAgent> {
  const metadata = await inspectInstalledAgentMetadata(
    agent,
    installed.command,
  );
  let options: ScannedAgent["options"];
  if (agent.id === "opencode") {
    const models = await readOpenCodeModels();
    options =
      models.length > 0
        ? models
        : await buildAgentImportOptions(agent.id, metadata);
  } else {
    options = await buildAgentImportOptions(
      agent.id,
      metadata,
    );
  }
  return {
    id: agent.id,
    command: installed.command,
    path: installed.path,
    installed: true,
    ...metadata,
    options,
    selectedOptionId: options?.[0]?.id,
  };
}
