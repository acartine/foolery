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
    populateFromCapsules(map, beats);
    overrideFromTerminals(map, terminals, leaseAgentInfoMap);
    return map;
  }, [isActiveView, beats, terminals, leaseAgentInfoMap]);
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
