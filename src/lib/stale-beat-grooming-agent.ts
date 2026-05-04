import { buildAnsiRedBanner } from "@/lib/ansi-red-banner";
import { resolvePoolAgent } from "@/lib/agent-pool";
import { loadSettings } from "@/lib/settings";
import { toCliTarget } from "@/lib/settings-agent-targets";
import type {
  FoolerySettings,
  RegisteredAgentConfig,
} from "@/lib/schemas";
import type { AgentTarget } from "@/lib/types-agent-target";
import type {
  StaleBeatGroomingAgentOption,
  StaleBeatGroomingOptions,
} from "@/lib/stale-beat-grooming-types";

export const STALE_GROOMING_FAILURE_MARKER =
  "FOOLERY GROOMING FAILURE";

export class StaleBeatGroomingFailureError extends Error {
  readonly banner: string;
  readonly status: number;

  constructor(message: string, status = 400) {
    const body = `${STALE_GROOMING_FAILURE_MARKER}: ${message}`;
    const banner = buildAnsiRedBanner(body);
    console.error(`\n${banner}\n`);
    super(body);
    this.name = "StaleBeatGroomingFailureError";
    this.banner = `\n${banner}\n`;
    this.status = status;
  }
}

export async function resolveStaleBeatGroomingAgent(input: {
  agentId?: string;
} = {}): Promise<AgentTarget> {
  const settings = await loadSettings();
  const agentId = input.agentId?.trim();
  if (!agentId) return resolveDefaultAgent(settings);
  return resolveExplicitAgent(settings, agentId);
}

export async function assertStaleBeatGroomingAgent(input: {
  agentId?: string;
} = {}): Promise<AgentTarget> {
  return resolveStaleBeatGroomingAgent(input);
}

export async function listStaleBeatGroomingAgentOptions():
  Promise<StaleBeatGroomingOptions> {
  const settings = await loadSettings();
  const agents = Object.entries(settings.agents)
    .map(([id, agent]) => agentOption(id, agent))
    .sort((left, right) => left.label.localeCompare(right.label));
  try {
    const selected = resolveDefaultAgent(settings);
    return {
      agents,
      ...(selected.agentId ? { defaultAgentId: selected.agentId } : {}),
    };
  } catch (error) {
    return {
      agents,
      defaultError: error instanceof Error
        ? error.message
        : String(error),
    };
  }
}

function resolveExplicitAgent(
  settings: FoolerySettings,
  agentId: string,
): AgentTarget {
  const configured = settings.agents[agentId];
  if (!configured) {
    throw new StaleBeatGroomingFailureError(
      `selected agent "${agentId}" is not registered; `
        + "add it under [agents] or pick another agent",
    );
  }
  return toCliTarget(configured, agentId);
}

function resolveDefaultAgent(settings: FoolerySettings): AgentTarget {
  if (settings.dispatchMode === "advanced") {
    const pool = settings.pools.stale_grooming;
    if (!pool || pool.length === 0) {
      throw new StaleBeatGroomingFailureError(
        "stale grooming dispatch is not configured; add "
          + "`[[pools.stale_grooming]]` entries pointing at a "
          + "registered agent or switch dispatchMode to basic and set "
          + "`actions.staleGrooming`",
        503,
      );
    }
    const selected = resolvePoolAgent(
      "stale_grooming",
      settings.pools,
      settings.agents,
    );
    if (!selected?.agentId) {
      throw new StaleBeatGroomingFailureError(
        "stale grooming pool has no eligible registered agents; "
          + "add a positive-weight `[[pools.stale_grooming]]` entry "
          + "whose `agentId` exists under `[agents]`",
        503,
      );
    }
    return selected;
  }

  const agentId = settings.actions.staleGrooming?.trim();
  if (!agentId) {
    throw new StaleBeatGroomingFailureError(
      "stale grooming action is not configured; set "
        + "`actions.staleGrooming` to a registered agent id or use "
        + "`dispatchMode = \"advanced\"` with `[[pools.stale_grooming]]`",
      503,
    );
  }
  const configured = settings.agents[agentId];
  if (!configured) {
    throw new StaleBeatGroomingFailureError(
      `actions.staleGrooming references missing agent "${agentId}"; `
        + "add that id under [agents] or update actions.staleGrooming",
      503,
    );
  }
  return toCliTarget(configured, agentId);
}

function agentOption(
  id: string,
  agent: RegisteredAgentConfig,
): StaleBeatGroomingAgentOption {
  return {
    id,
    label: agent.label
      ?? agent.agent_name
      ?? agent.model
      ?? id,
    command: agent.command,
    ...(agent.model ? { model: agent.model } : {}),
    ...(agent.vendor ? { vendor: agent.vendor } : {}),
    ...(agent.provider ? { provider: agent.provider } : {}),
  };
}
