/**
 * **The single canonical write-side normaliser for agent config.**
 *
 * `normalizeRegisteredAgentConfig` is the one and only function outside
 * `agent-identity.ts` itself that may invoke the canonical agent-identity
 * extractor (`toCanonicalAgentConfig`, which calls `normalizeAgentIdentity`
 * exactly once). It is invoked at write boundaries — agent registration,
 * CLI scan, auto-detect, and load-time auto-migration — to canonicalise raw
 * input. After this function runs, the persisted shape on disk and on every
 * downstream `RegisteredAgentConfig` is canonical: `agent_type`, `vendor`,
 * `provider`, `agent_name`, `lease_model`, `model`, `flavor`, `version`,
 * plus the structural fields `command` and `approvalMode`.
 *
 * Downstream readers — `getRegisteredAgents()`, `toCliTarget`,
 * scanner/detector consumers — read those canonical fields directly and
 * MUST NOT re-derive them.
 *
 * See `docs/knots-agent-identity-contract.md` § "Sanctioned exceptions".
 */
import type { RegisteredAgentConfig } from "@/lib/schemas";
import {
  detectAgentProviderId,
  formatAgentDisplayLabel,
  toCanonicalAgentConfig,
  type CanonicalAgentConfig,
} from "@/lib/agent-identity";

interface SettingsNormalizationResult {
  normalized: Record<string, unknown>;
  changedPaths: string[];
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function canonicalizeClaudeModel(
  rawModel: string,
): string {
  const cleaned = rawModel.trim().toLowerCase();
  const match = cleaned.match(
    /^(claude-(?:opus|sonnet|haiku))-(\d+(?:[-.]\d+)*)(.*)$/u,
  );
  if (!match) return cleaned;

  const [, family, version, suffix] = match;
  return `${family}-${version.replace(/\./gu, "-")}${suffix}`;
}

export function canonicalizeRuntimeModel(
  command: string | undefined,
  rawModel: string | undefined,
): string | undefined {
  const cleaned = cleanString(rawModel);
  if (!cleaned) return undefined;

  const providerId = detectAgentProviderId(command);
  if (providerId === "claude") {
    return canonicalizeClaudeModel(cleaned);
  }

  return cleaned;
}

/**
 * Canonicalise a raw scan/detect option into the canonical fields used to
 * build `ScannedAgent` / `ScannedAgentOption`.
 *
 * This is a thin sanctioned adapter over `toCanonicalAgentConfig` (the
 * single canonical write-side extractor in `agent-identity.ts`). It
 * exists so the CLI scanner and auto-detect paths consume canonical
 * fields without ever calling `normalizeAgentIdentity` themselves.
 *
 * Note: scan/detect output uses the canonical-family `model` token (e.g.
 * `"claude"`, `"gemini"`) and a separate `modelId` for the runtime id,
 * which is the pre-existing shape of `ScannedAgentOption`. This differs
 * from `RegisteredAgentConfig`'s persisted `model` field, which carries
 * the runtime id. Both shapes are downstream of the same canonical
 * extraction; the transformation is a pure projection.
 */
export interface CanonicalScanFields {
  provider?: string;
  model?: string;
  flavor?: string;
  version?: string;
}

export function canonicalizeScanFields(
  command: string,
  raw: { provider?: string; model?: string; flavor?: string; version?: string },
): CanonicalScanFields {
  const canonical: CanonicalAgentConfig = toCanonicalAgentConfig({
    command,
    ...(raw.provider ? { provider: raw.provider } : {}),
    ...(raw.model ? { model: raw.model } : {}),
    ...(raw.flavor ? { flavor: raw.flavor } : {}),
    ...(raw.version ? { version: raw.version } : {}),
  });
  return {
    ...(canonical.provider ? { provider: canonical.provider } : {}),
    ...(canonical.model ? { model: canonical.model } : {}),
    ...(canonical.flavor ? { flavor: canonical.flavor } : {}),
    ...(canonical.version ? { version: canonical.version } : {}),
  };
}

export function normalizeRegisteredAgentConfig(
  agent: RegisteredAgentConfig,
): RegisteredAgentConfig {
  const command = cleanString(agent.command) ?? agent.command;
  // The persisted `model` field is the concrete runtime id handed to the
  // CLI (e.g. `claude-opus-4-6`, `sonnet-4`, `openrouter/.../kimi-k2.6`).
  // Canonicalise its formatting (e.g. dot-versions → dash-versions for
  // Claude) but keep the runtime id — do NOT replace with the family token
  // (`claude`, `gpt`) that the canonical extractor parses out for the
  // lease's `lease_model` join.
  const runtimeModel = canonicalizeRuntimeModel(
    command,
    cleanString(agent.model),
  );
  const canonical = toCanonicalAgentConfig({
    command,
    agent_type: cleanString(agent.agent_type),
    vendor: cleanString(agent.vendor),
    provider: cleanString(agent.provider),
    agent_name: cleanString(agent.agent_name),
    lease_model: cleanString(agent.lease_model),
    model: runtimeModel,
    flavor: cleanString(agent.flavor),
    version: cleanString(agent.version),
  });

  // The display label is a pure formatter on already-canonical fields, not
  // a re-derivation — see `docs/knots-agent-identity-contract.md` § "What
  // Foolery Forbids Itself" item 4 / "Canonical Functions". Computing it
  // here at write time means readers don't recompute on every render.
  const label = formatAgentDisplayLabel({
    command,
    ...(canonical.provider ? { provider: canonical.provider } : {}),
    ...(runtimeModel ? { model: runtimeModel } : {}),
    ...(canonical.flavor ? { flavor: canonical.flavor } : {}),
    ...(canonical.version ? { version: canonical.version } : {}),
  });

  return {
    command,
    ...(canonical.agent_type
      ? { agent_type: canonical.agent_type }
      : {}),
    ...(canonical.vendor
      ? { vendor: canonical.vendor }
      : {}),
    ...(canonical.provider
      ? { provider: canonical.provider }
      : {}),
    ...(canonical.agent_name
      ? { agent_name: canonical.agent_name }
      : {}),
    ...(canonical.lease_model
      ? { lease_model: canonical.lease_model }
      : {}),
    ...(runtimeModel ? { model: runtimeModel } : {}),
    ...(canonical.flavor ? { flavor: canonical.flavor } : {}),
    ...(canonical.version
      ? { version: canonical.version }
      : {}),
    ...(agent.approvalMode
      ? { approvalMode: agent.approvalMode }
      : {}),
    ...(label ? { label } : {}),
  };
}

export function normalizeSettingsAgents(
  current: unknown,
): SettingsNormalizationResult {
  const normalizedRoot = structuredClone(
    isRecord(current) ? current : {},
  ) as Record<string, unknown>;
  const changedPaths: string[] = [];

  if (!isRecord(normalizedRoot.agents)) {
    return { normalized: normalizedRoot, changedPaths };
  }

  const normalizedAgents: Record<string, unknown> = {};
  for (const [agentId, rawAgent] of Object.entries(normalizedRoot.agents)) {
    if (!isRecord(rawAgent) || typeof rawAgent.command !== "string") {
      normalizedAgents[agentId] = rawAgent;
      continue;
    }

    const normalizedAgent = normalizeRegisteredAgentConfig(
      rawAgent as RegisteredAgentConfig,
    );
    normalizedAgents[agentId] = normalizedAgent;

    for (const key of [
      "command",
      "agent_type",
      "vendor",
      "provider",
      "agent_name",
      "lease_model",
      "model",
      "version",
      "flavor",
      "label",
    ] as const) {
      const before = cleanString(rawAgent[key]);
      const after = cleanString(normalizedAgent[key]);
      if (before !== after) {
        changedPaths.push(`agents.${agentId}.${key}`);
      }
    }
  }

  normalizedRoot.agents = normalizedAgents;

  const registeredIds = new Set(Object.keys(normalizedAgents));
  pruneOrphanActionRefs(normalizedRoot, registeredIds, changedPaths);
  pruneOrphanPoolRefs(normalizedRoot, registeredIds, changedPaths);

  return {
    normalized: normalizedRoot,
    changedPaths: Array.from(new Set(changedPaths)),
  };
}

const ACTION_KEYS = [
  "take",
  "scene",
  "scopeRefinement",
] as const;

function pruneOrphanActionRefs(
  root: Record<string, unknown>,
  registeredIds: Set<string>,
  changedPaths: string[],
): void {
  if (registeredIds.size === 0) return;
  if (!isRecord(root.actions)) return;
  const actions = root.actions;
  for (const key of ACTION_KEYS) {
    const value = actions[key];
    if (typeof value !== "string" || value === "") continue;
    if (!registeredIds.has(value)) {
      actions[key] = "";
      changedPaths.push(`actions.${key}`);
    }
  }
}

function pruneOrphanPoolRefs(
  root: Record<string, unknown>,
  registeredIds: Set<string>,
  changedPaths: string[],
): void {
  if (registeredIds.size === 0) return;
  if (!isRecord(root.pools)) return;
  const pools = root.pools;
  for (const [step, entries] of Object.entries(pools)) {
    if (!Array.isArray(entries)) continue;
    const filtered = entries.filter((entry) => {
      if (!isRecord(entry)) return true;
      const agentId = entry.agentId;
      return typeof agentId !== "string" || registeredIds.has(agentId);
    });
    if (filtered.length !== entries.length) {
      pools[step] = filtered;
      changedPaths.push(`pools.${step}`);
    }
  }
}
