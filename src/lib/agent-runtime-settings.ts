/**
 * Central provider runtime settings → dispatch-target plumbing.
 *
 * The `agentRuntime` settings block (see `src/lib/schemas.ts`) holds central,
 * provider-specific launch defaults: Codex speed + reasoning, Claude reasoning.
 * `attachAgentRuntimeSettings` is the single place that copies those central
 * values onto a freshly-resolved dispatch target, keyed off the target's CLI
 * dialect. The arg-builders in `agent-adapter.ts` then read `target.runtime`
 * and translate it into provider-specific flags.
 *
 * Only Codex and Claude carry runtime settings; every other dialect (Copilot,
 * OpenCode, Gemini) is returned unchanged. Claude deliberately has no `speed`
 * because the Claude CLI exposes no service-tier flag.
 */
import { resolveDialect } from "@/lib/agent-adapter";
import type { AgentRuntimeSettings } from "@/lib/schemas";
import type { CliAgentTarget } from "@/lib/types-agent-target";

/**
 * Return a copy of `target` with `runtime` populated from the central
 * `agentRuntime` settings for the target's dialect. Codex and Claude targets
 * gain runtime settings; all other dialects are returned unchanged.
 *
 * `agentRuntime` is always present on settings produced by
 * `foolerySettingsSchema` (it has genuine schema defaults). The
 * `undefined`/partial guards below mirror the codebase's existing defensive
 * access to optional settings sub-objects (e.g. `settings.pools?.[poolKey]`
 * in `dispatch-pool-resolver.ts`): with no central runtime block there is
 * simply nothing to stamp, so the target passes through unchanged. This is
 * the identity case of a transformation, not a substituted default.
 */
export function attachAgentRuntimeSettings(
  target: CliAgentTarget,
  agentRuntime: AgentRuntimeSettings | undefined,
): CliAgentTarget {
  if (!agentRuntime) return target;
  const dialect = resolveDialect(target.command);
  if (dialect === "codex" && agentRuntime.codex) {
    return {
      ...target,
      runtime: {
        speed: agentRuntime.codex.speed,
        reasoning: agentRuntime.codex.reasoning,
      },
    };
  }
  if (dialect === "claude" && agentRuntime.claude) {
    return {
      ...target,
      runtime: { reasoning: agentRuntime.claude.reasoning },
    };
  }
  return target;
}
