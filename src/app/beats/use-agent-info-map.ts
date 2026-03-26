import { useMemo } from "react";
import type { Beat } from "@/lib/types";
import type { AgentInfo } from "@/components/beat-columns";
import type { ActiveTerminal } from "@/stores/terminal-store";
import { toActiveAgentInfo } from "./to-active-agent-info";

export function useAgentInfoMap(
  isActiveView: boolean,
  beats: Beat[],
  terminals: ActiveTerminal[],
): Record<string, AgentInfo> {
  return useMemo<Record<string, AgentInfo>>(() => {
    if (!isActiveView) return {};
    const map: Record<string, AgentInfo> = {};
    populateFromCapsules(map, beats);
    overrideFromTerminals(map, terminals);
    return map;
  }, [isActiveView, beats, terminals]);
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
): void {
  for (const terminal of terminals) {
    if (terminal.status === "running") {
      map[terminal.beatId] = {
        agentName:
          terminal.agentName
          ?? map[terminal.beatId]?.agentName,
        ...toActiveAgentInfo({
          agentCommand: terminal.agentCommand,
          agentName: terminal.agentName,
          model: terminal.agentModel,
          version: terminal.agentVersion,
        }),
      };
    }
  }
}
