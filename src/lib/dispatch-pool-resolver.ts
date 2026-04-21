/**
 * Unified agent dispatch resolution.
 *
 * Single entry point for every workflow type (SDLC, gate, explore, any future
 * custom workflow). There are no type-specific branches: the beat's current
 * state, combined with its workflow descriptor, deterministically selects the
 * pool key (`workflow.queueActions[beat.state]`). `settings.pools[<poolKey>]`
 * is the authoritative source of which agent handles that state.
 *
 * If the derived pool key is empty / unconfigured / has no valid registered
 * agents, this module fails hard with a red ANSI banner in server logs AND a
 * matching stderr banner event for the session buffer. No silent fallback to
 * a "first registered agent" ever — that pattern previously routed every
 * gate-state dispatch to whichever agent happened to be first in the TOML.
 *
 * See CLAUDE.md §"Fail Loudly, Never Silently".
 */

import type {
  MemoryWorkflowDescriptor,
  PoolEntry,
} from "@/lib/types";
import type {
  FoolerySettings,
  RegisteredAgentConfig,
} from "@/lib/schemas";
import type {
  AgentTarget,
  CliAgentTarget,
} from "@/lib/types-agent-target";
import {
  selectFromPool,
  selectFromPoolStrict,
} from "@/lib/agent-pool";
import {
  workflowActionStateForState,
  workflowStatePhase,
} from "@/lib/workflows-runtime";
import { StepPhase } from "@/lib/workflows";

/** Greppable marker phrase for any dispatch failure. */
export const DISPATCH_FAILURE_MARKER = "FOOLERY DISPATCH FAILURE";

/** ANSI SGR colors used for the unmissable banner. */
const ANSI_RED_BG_WHITE = "\x1b[41;37;1m";
const ANSI_RESET = "\x1b[0m";

export interface DispatchFailureInfo {
  beatId: string;
  state: string;
  workflowId: string;
  poolKey: string | null;
  reason: "no_pool_key" | "no_pool_configured" | "pool_empty" | "no_eligible_agent";
  excluded?: ReadonlyArray<string>;
}

/**
 * Build the unmissable red banner. Writes to console.error AND returns the
 * banner string so the caller can push it to a session buffer as a stderr
 * event (surfaces in the UI).
 */
export function emitDispatchFailureBanner(
  info: DispatchFailureInfo,
): string {
  const heading =
    `${DISPATCH_FAILURE_MARKER}: cannot dispatch agent for beat ${info.beatId}`;
  const body = [
    `  state        = ${info.state}`,
    `  workflow     = ${info.workflowId}`,
    `  poolKey      = ${info.poolKey ?? "<none — workflow has no queueActions for this state>"}`,
    `  reason       = ${info.reason}`,
    info.excluded && info.excluded.length > 0
      ? `  excluded     = ${info.excluded.join(", ")}`
      : "",
    remediationFor(info),
  ]
    .filter(Boolean)
    .join("\n");

  const plain = [heading, body].join("\n");
  const banner = buildBanner(plain);

  console.error(
    `\n${ANSI_RED_BG_WHITE}${banner}${ANSI_RESET}\n`,
  );
  return `\n${ANSI_RED_BG_WHITE}${banner}${ANSI_RESET}\n`;
}

function buildBanner(inner: string): string {
  const lines = inner.split("\n");
  const width = Math.min(
    120,
    Math.max(...lines.map((l) => l.length), 40),
  );
  const edge = "═".repeat(width + 4);
  const top = `╔${edge}╗`;
  const bottom = `╚${edge}╝`;
  const middle = lines
    .map((l) => `║  ${l.padEnd(width)}  ║`)
    .join("\n");
  return [top, middle, bottom].join("\n");
}

function remediationFor(info: DispatchFailureInfo): string {
  const base = `  remediation  =`;
  switch (info.reason) {
    case "no_pool_key":
      return `${base} add \`queueActions.${info.state} = "<action state name>"\` to the workflow definition.`;
    case "no_pool_configured":
      return `${base} add \`[[pools.${info.poolKey}]]\` entries to ~/.config/foolery/settings.toml pointing at a registered agent.`;
    case "pool_empty":
      return `${base} \`[[pools.${info.poolKey}]]\` has no entries with weight > 0 referencing a currently-registered agent.`;
    case "no_eligible_agent":
      return `${base} every agent in \`[[pools.${info.poolKey}]]\` was excluded (e.g., cross-agent review); add another registered agent to this pool.`;
  }
}

/** Error thrown by resolveDispatchAgent on unresolvable dispatch. */
export class DispatchFailureError extends Error {
  readonly info: DispatchFailureInfo;
  readonly banner: string;
  constructor(info: DispatchFailureInfo) {
    const banner = emitDispatchFailureBanner(info);
    super(
      `${DISPATCH_FAILURE_MARKER}: beat=${info.beatId} ` +
      `state=${info.state} workflow=${info.workflowId} ` +
      `poolKey=${info.poolKey ?? "<none>"} reason=${info.reason}`,
    );
    this.name = "DispatchFailureError";
    this.info = info;
    this.banner = banner;
  }
}

export interface DispatchContext {
  beatId: string;
  state: string;
  workflow: MemoryWorkflowDescriptor;
  settings: FoolerySettings;
}

export interface ResolveDispatchOptions {
  /** Exclude these agent IDs (e.g., cross-agent review). */
  excludeAgentIds?: string | ReadonlySet<string>;
  /** When true, never fall back to the excluded agent even if it's the only candidate. */
  strictExclusion?: boolean;
}

/**
 * Resolve the agent target for a beat's current workflow state. One branch,
 * identical for every workflow type. Throws `DispatchFailureError` with a red
 * banner when no agent can be selected.
 *
 * Returns `null` for states where dispatch is not applicable (terminal,
 * non-agent-owned). Callers that treat `null` as "no session needed" are
 * responsible for that policy; callers that expect dispatch MUST treat null
 * as invalid input.
 */
export function resolveDispatchAgent(
  ctx: DispatchContext,
  options: ResolveDispatchOptions = {},
): CliAgentTarget | null {
  const phase = workflowStatePhase(ctx.workflow, ctx.state);
  if (phase === "terminal" || phase === null) return null;

  const poolKey = derivePoolKey(ctx);
  if (!poolKey) {
    throw new DispatchFailureError({
      beatId: ctx.beatId,
      state: ctx.state,
      workflowId: ctx.workflow.id,
      poolKey: null,
      reason: "no_pool_key",
    });
  }

  const pool: PoolEntry[] | undefined = ctx.settings.pools?.[poolKey];
  if (!pool || pool.length === 0) {
    throw new DispatchFailureError({
      beatId: ctx.beatId,
      state: ctx.state,
      workflowId: ctx.workflow.id,
      poolKey,
      reason: "no_pool_configured",
    });
  }

  const agents: Record<string, RegisteredAgentConfig> = ctx.settings.agents ?? {};
  const selected: AgentTarget | null = options.strictExclusion
    ? selectFromPoolStrict(pool, agents, options.excludeAgentIds ?? new Set())
    : selectFromPool(pool, agents, options.excludeAgentIds);

  if (!selected) {
    const validAgents = pool.filter(
      (e) => e.weight > 0 && agents[e.agentId],
    );
    const reason =
      validAgents.length === 0 ? "pool_empty" : "no_eligible_agent";
    throw new DispatchFailureError({
      beatId: ctx.beatId,
      state: ctx.state,
      workflowId: ctx.workflow.id,
      poolKey,
      reason,
      excluded: excludedAgentIdList(options.excludeAgentIds),
    });
  }

  if (selected.kind !== "cli") {
    throw new DispatchFailureError({
      beatId: ctx.beatId,
      state: ctx.state,
      workflowId: ctx.workflow.id,
      poolKey,
      reason: "no_eligible_agent",
    });
  }
  return selected;
}

/**
 * Compute the pool key for a beat's state. Queue states map to their action
 * state via `workflow.queueActions`; active states are their own pool key.
 */
export function derivePoolKey(ctx: DispatchContext): string | null {
  const phase = workflowStatePhase(ctx.workflow, ctx.state);
  if (phase === StepPhase.Active) return ctx.state;
  if (phase === StepPhase.Queued) {
    return workflowActionStateForState(ctx.workflow, ctx.state) ?? null;
  }
  return null;
}

function excludedAgentIdList(
  value?: string | ReadonlySet<string>,
): string[] {
  if (!value) return [];
  if (typeof value === "string") return [value];
  return [...value];
}
