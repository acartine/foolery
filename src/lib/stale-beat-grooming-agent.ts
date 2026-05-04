import { buildAnsiRedBanner } from "@/lib/ansi-red-banner";
import { loadSettings } from "@/lib/settings";
import { toCliTarget } from "@/lib/settings-agent-targets";
import type { AgentTarget } from "@/lib/types-agent-target";

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
  agentId: string;
  modelOverride?: string;
}): Promise<AgentTarget> {
  const agentId = input.agentId.trim();
  if (!agentId) {
    throw new StaleBeatGroomingFailureError(
      "selected agent id is required; pick a registered agent",
    );
  }

  const settings = await loadSettings();
  const configured = settings.agents[agentId];
  if (!configured) {
    throw new StaleBeatGroomingFailureError(
      `selected agent "${agentId}" is not registered; `
        + "add it under [agents] or pick another agent",
    );
  }

  const modelOverride = input.modelOverride?.trim();
  return toCliTarget(
    {
      ...configured,
      ...(modelOverride ? { model: modelOverride } : {}),
    },
    agentId,
  );
}

export async function assertStaleBeatGroomingAgent(input: {
  agentId: string;
  modelOverride?: string;
}): Promise<void> {
  await resolveStaleBeatGroomingAgent(input);
}
