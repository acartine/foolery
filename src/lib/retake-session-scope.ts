import type { Beat } from "@/lib/types";
import type { ActiveTerminal } from "@/stores/terminal-store";

type BeatWithRepoPath = Beat & { _repoPath?: string };

export function getBeatRepoPath(beat: Beat): string | undefined {
  return (beat as BeatWithRepoPath)._repoPath;
}

export function repoScopedBeatKey(beatId: string, repoPath?: string): string {
  return `${repoPath ?? ""}::${beatId}`;
}

export function buildRetakeShippingIndex(terminals: ActiveTerminal[]): Record<string, string> {
  const acc: Record<string, string> = {};
  for (const terminal of terminals) {
    if (terminal.status === "running") {
      acc[repoScopedBeatKey(terminal.beatId, terminal.repoPath)] = terminal.sessionId;
    }
  }
  return acc;
}

export function buildRetakeParentIndex(beats: Beat[]): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>();
  for (const beat of beats) {
    const repoPath = getBeatRepoPath(beat);
    map.set(
      repoScopedBeatKey(beat.id, repoPath),
      beat.parent ? repoScopedBeatKey(beat.parent, repoPath) : undefined
    );
  }
  return map;
}

export function findRunningTerminalForBeat(
  terminals: ActiveTerminal[],
  beatId: string,
  repoPath?: string
): ActiveTerminal | undefined {
  return terminals.find(
    (terminal) =>
      terminal.status === "running" &&
      repoScopedBeatKey(terminal.beatId, terminal.repoPath) === repoScopedBeatKey(beatId, repoPath)
  );
}
