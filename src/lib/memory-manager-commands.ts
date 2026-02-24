import { detectMemoryManagerType } from "@/lib/memory-manager-detection";
import type { MemoryManagerType } from "@/lib/memory-managers";

interface MemoryManagerCommandOptions {
  noDaemon?: boolean;
}

function quoteId(id: string): string {
  return JSON.stringify(id);
}

function beadsNoDaemonFlag(options?: MemoryManagerCommandOptions): string {
  return options?.noDaemon ? " --no-daemon" : "";
}

export function resolveMemoryManagerType(repoPath?: string): MemoryManagerType {
  if (!repoPath) return "beads";
  return detectMemoryManagerType(repoPath) ?? "beads";
}

export function buildShowIssueCommand(id: string, memoryManagerType: MemoryManagerType): string {
  if (memoryManagerType === "knots") return `knots show ${quoteId(id)}`;
  return `bd show ${quoteId(id)}`;
}

export function buildVerificationStageCommand(
  id: string,
  memoryManagerType: MemoryManagerType,
  options?: MemoryManagerCommandOptions,
): string {
  if (memoryManagerType === "knots") {
    return `knots update ${quoteId(id)} --status implementing --add-tag stage:verification`;
  }
  return `bd update ${quoteId(id)} --status in_progress --add-label stage:verification${beadsNoDaemonFlag(options)}`;
}

export function buildVerificationRetryCommands(
  id: string,
  memoryManagerType: MemoryManagerType,
  options?: MemoryManagerCommandOptions,
): string[] {
  if (memoryManagerType === "knots") {
    return [
      `knots update ${quoteId(id)} --remove-tag stage:verification --remove-tag transition:verification --add-tag stage:retry`,
    ];
  }

  const noDaemon = beadsNoDaemonFlag(options);
  return [
    `bd label remove ${quoteId(id)} stage:verification${noDaemon}`,
    `bd label remove ${quoteId(id)} transition:verification${noDaemon}`,
    `bd label add ${quoteId(id)} stage:retry${noDaemon}`,
  ];
}

export function buildVerificationPassCommands(
  id: string,
  memoryManagerType: MemoryManagerType,
  options?: MemoryManagerCommandOptions,
): string[] {
  if (memoryManagerType === "knots") {
    return [
      `knots update ${quoteId(id)} --remove-tag stage:verification --remove-tag transition:verification --status shipped --force`,
    ];
  }

  const noDaemon = beadsNoDaemonFlag(options);
  return [
    `bd label remove ${quoteId(id)} stage:verification${noDaemon}`,
    `bd label remove ${quoteId(id)} transition:verification${noDaemon}`,
    `bd close ${quoteId(id)}`,
  ];
}
