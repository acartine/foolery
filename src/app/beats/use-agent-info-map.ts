import { useMemo } from "react";
import type { Beat, TerminalSessionAgentInfo } from "@/lib/types";
import type { AgentInfo } from "@/components/beat-columns";
import type { ActiveTerminal } from "@/stores/terminal-store";
import { toActiveAgentInfo } from "./to-active-agent-info";
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

function populateFromCapsules(
  map: Record<string, AgentInfo>,
  beats: Beat[],
): void {
  for (const beat of beats) {
    const capsules =
      beat.metadata?.knotsHandoffCapsules;
    if (!Array.isArray(capsules) || capsules.length === 0) {
      continue;
    }
    const last = capsules[capsules.length - 1] as
      Record<string, unknown>;
    map[beat.id] = toActiveAgentInfo({
      agentCommand:
        typeof last.agentname === "string"
          ? last.agentname : undefined,
      agentName:
        typeof last.agentname === "string"
          ? last.agentname : undefined,
      model:
        typeof last.model === "string"
          ? last.model : undefined,
      version:
        typeof last.version === "string"
          ? last.version : undefined,
    });
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
