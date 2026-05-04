import type { OverviewLeaseInfo } from "@/lib/beat-state-overview";
import type {
  TerminalSessionAgentInfo,
} from "@/lib/types";
import type { ActiveTerminal } from "@/stores/terminal-store";

export function buildOverviewLeaseInfoByBeatKey(
  terminals: ActiveTerminal[],
  agentInfoMap: Map<string, TerminalSessionAgentInfo>,
): Record<string, OverviewLeaseInfo> {
  const byKey: Record<string, OverviewLeaseInfo> = {};

  for (const terminal of terminals) {
    if (terminal.status !== "running") continue;
    const agentInfo = agentInfoMap.get(terminal.sessionId);
    const info = terminalLeaseInfo(terminal.startedAt, agentInfo);
    for (const beatId of terminalBeatIds(terminal)) {
      byKey[beatId] = info;
      if (terminal.repoPath) {
        byKey[`${terminal.repoPath}:${beatId}`] = info;
      }
    }
  }

  return byKey;
}

function terminalLeaseInfo(
  startedAt: string,
  agentInfo: TerminalSessionAgentInfo | undefined,
): OverviewLeaseInfo {
  return {
    startedAt,
    ...(agentInfo?.agentProvider
      ? { provider: agentInfo.agentProvider }
      : {}),
    ...(agentInfo?.agentModel
      ? { model: agentInfo.agentModel }
      : {}),
    ...(agentInfo?.agentVersion
      ? { version: agentInfo.agentVersion }
      : {}),
  };
}

function terminalBeatIds(
  terminal: ActiveTerminal,
): string[] {
  return Array.from(new Set([
    terminal.beatId,
    ...(terminal.beatIds ?? []),
  ]));
}
