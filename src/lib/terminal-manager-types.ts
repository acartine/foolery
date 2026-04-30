import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { InteractionLog } from "@/lib/interaction-logger";
import type { TerminalSession, TerminalEvent } from "@/lib/types";
import type { ExecutionAgentInfo } from "@/lib/execution-port";
import type {
  TakeLoopIterationTrace,
} from "@/lib/terminal-manager-take-lifecycle";
import type {
  ApprovalAction,
  ApprovalReplyResult,
  PendingApprovalRecord,
} from "@/lib/approval-actions";

export interface SessionEntry {
  session: TerminalSession;
  process: ChildProcess | null;
  abort?: () => void;
  releaseKnotsLease?: (
    reason: string,
    outcome?: "success" | "warning" | "error",
    data?: Record<string, unknown>,
  ) => void;
  emitter: EventEmitter;
  buffer: TerminalEvent[];
  interactionLog: InteractionLog;
  knotsLeaseId?: string;
  knotsLeaseSeq?: number;
  knotsLeaseStep?: string;
  knotsLeaseAgentInfo?: ExecutionAgentInfo;
  lastReleasedKnotsLeaseId?: string;
  takeLoopLifecycle?: Map<number, TakeLoopIterationTrace>;
  pendingApprovals?: Map<string, PendingApprovalRecord>;
  approvalResponder?: (
    record: PendingApprovalRecord,
    action: ApprovalAction,
  ) => Promise<ApprovalReplyResult>;
  approvalBridgeBaseUrl?: string;
  approvalBridgeToken?: string;
}

export const INPUT_CLOSE_GRACE_MS = 2000;

/**
 * Mirror the entry's authoritative `knotsLeaseId` and `knotsLeaseAgentInfo`
 * onto its `session` so HTTP responses (`listSessions`, `createSession`)
 * carry the canonical, autostamp-derived agent identity.
 *
 * Called after `acquireKnotsLease`, after lease rotations in
 * `terminal-manager-take-agent`, and on lease release.
 *
 * See `docs/knots-agent-identity-contract.md` rule 5.
 */
export function syncSessionLeaseInfo(entry: SessionEntry): void {
  entry.session.knotsLeaseId = entry.knotsLeaseId;
  entry.session.knotsAgentInfo = entry.knotsLeaseAgentInfo
    ? {
        agentName: entry.knotsLeaseAgentInfo.agentName,
        agentModel: entry.knotsLeaseAgentInfo.agentModel,
        agentVersion: entry.knotsLeaseAgentInfo.agentVersion,
        agentProvider: entry.knotsLeaseAgentInfo.agentProvider,
      }
    : undefined;
}

/**
 * Resolve a CLI command that may not be on PATH.
 * Checks common locations (bun global bin).
 * Returns the original command if no alternative found.
 */
export function resolveAgentCommand(
  command: string,
): string {
  if (command.includes("/")) return command;
  const bunBin = join(
    homedir(),
    ".bun",
    "bin",
    command,
  );
  if (existsSync(bunBin)) return bunBin;
  return command;
}
