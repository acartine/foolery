import { detectMemoryManagerType } from "@/lib/memory-manager-detection";
import type { MemoryManagerType } from "@/lib/memory-managers";
import { mapWorkflowStateToCompatStatus } from "@/lib/backends/beads-compat-status";
import { updateKnot } from "@/lib/knots";
import type { Beat } from "@/lib/types";

interface MemoryManagerCommandOptions {
  noDaemon?: boolean;
  leaseId?: string;
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

export function buildClaimCommand(
  id: string,
  memoryManagerType: MemoryManagerType,
  leaseId?: string,
): string {
  if (memoryManagerType === "knots") {
    const base = `kno claim ${quoteId(id)} --json`;
    return leaseId ? `${base} --lease ${quoteArg(leaseId)}` : base;
  }
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
    const base = `kno next ${quoteId(id)} --expected-state ${quoteArg(normalizedState)} --actor-kind agent`;
    return options?.leaseId ? `${base} --lease ${quoteArg(options.leaseId)}` : base;
  }
  const compatStatus = mapWorkflowStateToCompatStatus(normalizedState);
  return `bd update ${quoteId(id)} --status ${quoteArg(compatStatus)} --add-label ${quoteArg(`wf:state:${normalizedState}`)}${beatsNoDaemonFlag(options)}`;
}

export async function rollbackBeatState(
  beatId: string,
  fromState: string,
  toState: string,
  repoPath: string | undefined,
  memoryManagerType: MemoryManagerType,
  reason?: string,
): Promise<void> {
  if (memoryManagerType === "knots") {
    const cmd = `kno rollback ${quoteId(beatId)} --actor-kind agent`;
    const { exec: execCb } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(execCb);
    await execAsync(cmd, { cwd: repoPath });

    // Add a note on the knot documenting the rollback (best-effort)
    if (reason) {
      try {
        await updateKnot(beatId, { addNote: reason }, repoPath);
      } catch { /* note is best-effort */ }
    }
  } else {
    const { getBackend } = await import("@/lib/backend-instance");
    await getBackend().update(beatId, { state: toState }, repoPath);
  }
}

export function assertClaimable(
  beats: Beat[],
  action: string,
  memoryManagerType: MemoryManagerType,
): void {
  if (memoryManagerType !== "knots") return;
  const blocked = beats.filter((b) => b.isAgentClaimable === false);
  if (blocked.length === 0) return;
  const summary = blocked
    .map((b) => `${b.id}${b.state ? ` (${b.state})` : ""}`)
    .join(", ");
  throw new Error(
    `${action} unavailable: knot is not agent-claimable (${summary})`,
  );
}

export function supportsAutoFollowUp(memoryManagerType: MemoryManagerType): boolean {
  return memoryManagerType !== "knots";
}
