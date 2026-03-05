import { detectMemoryManagerType } from "@/lib/memory-manager-detection";
import type { MemoryManagerType } from "@/lib/memory-managers";
import { mapWorkflowStateToCompatStatus } from "@/lib/workflows";

interface MemoryManagerCommandOptions {
  noDaemon?: boolean;
}

function quoteId(id: string): string {
  return JSON.stringify(id);
}

function quoteArg(value: string): string {
  return JSON.stringify(value);
}

function beatsNoDaemonFlag(options?: MemoryManagerCommandOptions): string {
  return options?.noDaemon ? " --no-daemon" : "";
}

export function resolveMemoryManagerType(repoPath?: string): MemoryManagerType {
  if (!repoPath) return "beads";
  return detectMemoryManagerType(repoPath) ?? "beads";
}

export function buildShowIssueCommand(id: string, memoryManagerType: MemoryManagerType): string {
  if (memoryManagerType === "knots") return `kno show ${quoteId(id)}`;
  return `bd show ${quoteId(id)}`;
}

export function buildClaimCommand(id: string, memoryManagerType: MemoryManagerType): string {
  if (memoryManagerType === "knots") return `kno claim ${quoteId(id)} --json`;
  return buildShowIssueCommand(id, memoryManagerType);
}

export function buildWorkflowStateCommand(
  id: string,
  workflowState: string,
  memoryManagerType: MemoryManagerType,
  options?: MemoryManagerCommandOptions,
): string {
  const normalizedState = workflowState.trim().toLowerCase();
  if (memoryManagerType === "knots") {
    return `kno next ${quoteId(id)} --expected-state ${quoteArg(normalizedState)} --actor-kind agent`;
  }
  const compatStatus = mapWorkflowStateToCompatStatus(normalizedState, "memory-manager-commands");
  return `bd update ${quoteId(id)} --status ${quoteArg(compatStatus)} --add-label ${quoteArg(`wf:state:${normalizedState}`)}${beatsNoDaemonFlag(options)}`;
}

