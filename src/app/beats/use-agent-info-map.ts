import { useMemo } from "react";
import type { Beat, TerminalSessionAgentInfo } from "@/lib/types";
import type { AgentInfo } from "@/components/beat-columns";
import type { ActiveTerminal } from "@/stores/terminal-store";
import { useTerminalAgentInfoMap } from "./use-terminal-agent-info";

export function useAgentInfoMap(
  isActiveView: boolean,
  beats: Beat[],
  terminals: ActiveTerminal[],
): Record<string, AgentInfo> {
  // Lease-derived agent identity for every active terminal.  Empty until the
  // first /api/terminal fetch resolves, at which point React Query
  // re-renders downstream consumers.
  const leaseAgentInfoMap = useTerminalAgentInfoMap();
  return useMemo<Record<string, AgentInfo>>(() => {
    if (!isActiveView) return {};
    const map: Record<string, AgentInfo> = {};
    // For lease-type knots, the lease's own `agent_info` is the
    // canonical source — no steps / notes / capsules exist on a
    // fresh lease. Populate first so capsule + terminal overrides
    // can still take precedence when more current data exists.
    populateFromLeaseAgentInfo(map, beats);
    populateFromCapsules(map, beats);
    overrideFromTerminals(map, terminals, leaseAgentInfoMap);
    return map;
  }, [isActiveView, beats, terminals, leaseAgentInfoMap]);
}

/**
 * Read canonical agent identity off a Lease knot's own `agent_info`.
 *
 * The mapper at `src/lib/backends/knots-backend-mappers.ts` surfaces
 * `knot.lease.agent_info` as `metadata.knotsLeaseAgentInfo` for any knot
 * that has a bound lease. For Lease-type knots specifically, this is the
 * ONLY canonical source — there are no steps, notes, or handoff capsules
 * to read from on a fresh lease. Per the agent-identity contract, this
 * is a pure rename: lease.agent_info.{agent_name,model,model_version}
 * → AgentInfo.{agentName,model,version}. No parsing, no normalisation.
 */
function populateFromLeaseAgentInfo(
  map: Record<string, AgentInfo>,
  beats: Beat[],
): void {
  for (const beat of beats) {
    const info = beat.metadata?.knotsLeaseAgentInfo;
    if (!info || typeof info !== "object") continue;
    const ai = info as Record<string, unknown>;
    const agentName =
      typeof ai.agent_name === "string" ? ai.agent_name : undefined;
    const model = typeof ai.model === "string" ? ai.model : undefined;
    const version =
      typeof ai.model_version === "string" ? ai.model_version : undefined;
    if (!agentName && !model && !version) continue;
    map[beat.id] = {
      ...(agentName ? { agentName } : {}),
      ...(model ? { model } : {}),
      ...(version ? { version } : {}),
    };
  }
}

/**
 * Read canonical agent identity off the latest handoff capsule.
 *
 * Per `docs/knots-agent-identity-contract.md` rule 4, Knots stamps
 * `agentname` / `model` / `version` onto every handoff capsule from the
 * bound lease's `agent_info`. Per rule 5, the display layer reads those
 * stamped fields directly — it never re-extracts. Per rule 8, Foolery
 * only extracts at lease setup, never at display time.
 *
 * This function is therefore a pure rename: capsule.agentname →
 * AgentInfo.agentName, capsule.model → AgentInfo.model, capsule.version
 * → AgentInfo.version. No parsing, no normalisation, no fallback
 * literals.
 */
function populateFromCapsules(
  map: Record<string, AgentInfo>,
  beats: Beat[],
): void {
  for (const beat of beats) {
    const capsules = beat.metadata?.knotsHandoffCapsules;
    if (!Array.isArray(capsules) || capsules.length === 0) {
      continue;
    }
    const last = capsules[capsules.length - 1] as
      Record<string, unknown>;
    const agentName =
      typeof last.agentname === "string" ? last.agentname : undefined;
    const model =
      typeof last.model === "string" ? last.model : undefined;
    const version =
      typeof last.version === "string" ? last.version : undefined;
    map[beat.id] = {
      ...(agentName ? { agentName } : {}),
      ...(model ? { model } : {}),
      ...(version ? { version } : {}),
    };
  }
}

function overrideFromTerminals(
  map: Record<string, AgentInfo>,
  terminals: ActiveTerminal[],
  leaseAgentInfoMap: Map<string, TerminalSessionAgentInfo>,
): void {
  for (const terminal of terminals) {
    if (terminal.status !== "running") continue;
    const leaseInfo = leaseAgentInfoMap.get(terminal.sessionId);
    if (!leaseInfo) continue;
    map[terminal.beatId] = leaseInfoToAgentInfo(leaseInfo);
  }
}

/**
 * Project the lease-derived `TerminalSessionAgentInfo` (already canonical)
 * onto the display-shaped `AgentInfo`.  Pure rename; never re-extracts.
 */
function leaseInfoToAgentInfo(
  info: TerminalSessionAgentInfo,
): AgentInfo {
  return {
    ...(info.agentName ? { agentName: info.agentName } : {}),
    ...(info.agentModel ? { model: info.agentModel } : {}),
    ...(info.agentVersion ? { version: info.agentVersion } : {}),
  };
}
