/**
 * Canonical agent-config / lease-identity extraction.
 *
 * Companion to `agent-identity.ts`. The display formatters and per-provider
 * normalisers live next door; the canonicalisation that turns
 * `AgentIdentityLike` into the canonical `CanonicalLeaseIdentity` /
 * `CanonicalAgentConfig` shapes lives here.
 *
 * `toCanonicalAgentConfig` is **the single canonical write-side
 * extractor** — the one and only function outside `agent-identity*.ts`
 * itself that callers in the settings layer may invoke. See
 * `docs/knots-agent-identity-contract.md` § "Sanctioned exceptions".
 */
import type { ExecutionAgentInfo } from "@/lib/execution-port";
import {
  type AgentIdentityLike,
  detectAgentProviderId,
  displayCommandLabel,
  normalizeAgentIdentity,
} from "@/lib/agent-identity";

export interface CanonicalLeaseIdentity {
  agent_type?: string;
  vendor?: string;
  provider?: string;
  agent_name?: string;
  lease_model?: string;
  version?: string;
}

/**
 * Canonical agent-config shape persisted to `settings.toml`. Superset of
 * `CanonicalLeaseIdentity` — adds `model` (the runtime model id handed to
 * the CLI) and `flavor` (the variant/router tag). Produced exactly once per
 * registration event by `toCanonicalAgentConfig`; downstream readers
 * (settings hydration, scan output, target resolution) consume these
 * fields directly without re-running any extractor.
 */
export interface CanonicalAgentConfig extends CanonicalLeaseIdentity {
  model?: string;
  flavor?: string;
}

function cleanValue(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

interface CanonicalCore {
  normalized: ReturnType<typeof normalizeAgentIdentity>;
  agentType?: string;
  vendor?: string;
  provider?: string;
  agentName: string;
  leaseModel?: string;
  version?: string;
}

function buildCanonicalCore(agent: AgentIdentityLike): CanonicalCore {
  const n = normalizeAgentIdentity(agent);
  const explicitCommand = cleanValue(agent.command);
  const agentType =
    cleanValue(agent.agent_type)
    ?? cleanValue(agent.kind)
    ?? "cli";
  const vendor = cleanValue(agent.vendor)
    ?? (explicitCommand
      ? detectAgentProviderId(explicitCommand)
      : undefined);
  // The canonical extractor's output (`n.provider`) is authoritative — for
  // Copilot in particular it remaps to the inner provider (Claude/Codex/
  // Gemini) when the model hints at one. Falling back to the input only
  // when the extractor produced nothing preserves the contract.
  const provider = n.provider ?? cleanValue(agent.provider);
  const agentName = cleanValue(agent.agent_name)
    ?? displayCommandLabel(explicitCommand)
    ?? provider
    ?? explicitCommand
    ?? "Unknown";
  // OpenCode model strings are already canonical display strings
  // (e.g. "OpenRouter MoonshotAI Kimi-k") with the version split off
  // — the formatter has done the work. Other providers join the
  // display-cased flavor and model with "/" (e.g. "Opus/Claude",
  // "Codex/GPT"). Flavor "Codex" + model "GPT" -> "Codex/GPT".
  //
  // Per foolery-b42b: the parsed value from the canonical extractor
  // wins over the caller's `lease_model` field. This is what makes
  // the migration work — legacy machine-form lease_model values
  // ("opus/claude") on disk get overwritten by the display-form
  // values produced here ("Opus/Claude"). Caller's lease_model is
  // honoured only as a fallback when the extractor produced nothing.
  const derivedLeaseModel = n.provider === "OpenCode"
    ? (n.model ?? cleanValue(agent.model))
    : [n.flavor, n.model].filter(Boolean).join("/")
      || cleanValue(agent.model);
  const leaseModel = derivedLeaseModel
    ?? cleanValue(agent.lease_model);

  return {
    normalized: n,
    agentType,
    ...(vendor && vendor !== "unknown" ? { vendor } : {}),
    ...(provider ? { provider } : {}),
    agentName,
    ...(leaseModel ? { leaseModel } : {}),
    ...(n.version ? { version: n.version } : {}),
  };
}

export function toCanonicalLeaseIdentity(
  agent: AgentIdentityLike,
): CanonicalLeaseIdentity {
  const core = buildCanonicalCore(agent);
  return {
    ...(core.agentType ? { agent_type: core.agentType } : {}),
    ...(core.vendor ? { vendor: core.vendor } : {}),
    ...(core.provider ? { provider: core.provider } : {}),
    ...(core.agentName ? { agent_name: core.agentName } : {}),
    ...(core.leaseModel ? { lease_model: core.leaseModel } : {}),
    ...(core.version ? { version: core.version } : {}),
  };
}

/**
 * **The single canonical write-side extractor.** This is the one and only
 * function outside `agent-identity*.ts` itself that callers in the
 * settings layer may invoke to canonicalize raw agent input. It runs
 * `normalizeAgentIdentity` exactly once per call, derives the full
 * persisted shape (`agent_type`, `vendor`, `provider`, `agent_name`,
 * `lease_model`, `model`, `flavor`, `version`), and returns it. After this
 * function runs at registration / scan / detect time, the data on disk IS
 * canonical — no further normalisation is required at read time.
 *
 * See `docs/knots-agent-identity-contract.md` § "Sanctioned exceptions".
 */
export function toCanonicalAgentConfig(
  agent: AgentIdentityLike,
): CanonicalAgentConfig {
  const core = buildCanonicalCore(agent);
  const model = cleanValue(core.normalized.model) ?? cleanValue(agent.model);
  const flavor =
    cleanValue(core.normalized.flavor) ?? cleanValue(agent.flavor);
  return {
    ...(core.agentType ? { agent_type: core.agentType } : {}),
    ...(core.vendor ? { vendor: core.vendor } : {}),
    ...(core.provider ? { provider: core.provider } : {}),
    ...(core.agentName ? { agent_name: core.agentName } : {}),
    ...(core.leaseModel ? { lease_model: core.leaseModel } : {}),
    ...(model ? { model } : {}),
    ...(flavor ? { flavor } : {}),
    ...(core.version ? { version: core.version } : {}),
  };
}

export function toExecutionAgentInfo(
  agent: AgentIdentityLike,
): ExecutionAgentInfo {
  const canonical = toCanonicalLeaseIdentity(agent);
  return {
    agentName: canonical.agent_name,
    agentProvider: canonical.provider,
    agentModel: canonical.lease_model,
    agentVersion: canonical.version,
    agentType: canonical.agent_type,
  };
}
