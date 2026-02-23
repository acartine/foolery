import { detectIssueTrackerType } from "@/lib/issue-tracker-detection";
import type { IssueTrackerType } from "@/lib/issue-trackers";

interface TrackerCommandOptions {
  noDaemon?: boolean;
}

function quoteId(id: string): string {
  return JSON.stringify(id);
}

function beadsNoDaemonFlag(options?: TrackerCommandOptions): string {
  return options?.noDaemon ? " --no-daemon" : "";
}

export function resolveIssueTrackerType(repoPath?: string): IssueTrackerType {
  if (!repoPath) return "beads";
  return detectIssueTrackerType(repoPath) ?? "beads";
}

export function buildShowIssueCommand(id: string, trackerType: IssueTrackerType): string {
  if (trackerType === "knots") return `knots show ${quoteId(id)}`;
  return `bd show ${quoteId(id)}`;
}

export function buildVerificationStageCommand(
  id: string,
  trackerType: IssueTrackerType,
  options?: TrackerCommandOptions,
): string {
  if (trackerType === "knots") {
    return `knots update ${quoteId(id)} --status implementing --add-tag stage:verification`;
  }
  return `bd update ${quoteId(id)} --status in_progress --add-label stage:verification${beadsNoDaemonFlag(options)}`;
}

export function buildVerificationRetryCommands(
  id: string,
  trackerType: IssueTrackerType,
  options?: TrackerCommandOptions,
): string[] {
  if (trackerType === "knots") {
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
  trackerType: IssueTrackerType,
  options?: TrackerCommandOptions,
): string[] {
  if (trackerType === "knots") {
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
