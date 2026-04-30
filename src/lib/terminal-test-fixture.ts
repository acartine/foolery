import { EventEmitter } from "node:events";
import { noopInteractionLog } from "@/lib/interaction-logger";
import { getTerminalSessions } from "@/lib/terminal-session-registry";
import {
  cleanupTerminalSessionResources,
} from "@/lib/terminal-session-cleanup";
import { clearApprovalRegistry } from "@/lib/approval-registry";
import type { SessionEntry } from "@/lib/terminal-manager-types";
import type {
  TerminalEvent,
  TerminalSession,
  TerminalSessionStatus,
} from "@/lib/types";

const MAX_BUFFER = 5_000;
const FIXTURE_CLEANUP_DELAY_MS = 250;

type FixtureSessionInput = {
  id: string;
  beatId: string;
  beatTitle: string;
  repoPath?: string;
  knotsLeaseId?: string;
  agentName?: string;
  agentModel?: string;
  agentVersion?: string;
  agentProvider?: string;
  startedAt?: string;
};

function fixtureStatusForExit(
  exitCode: number,
): TerminalSessionStatus {
  return exitCode === 0 ? "completed" : "error";
}

function pushBufferedEvent(
  entry: SessionEntry,
  event: TerminalEvent,
): void {
  if (entry.buffer.length >= MAX_BUFFER) {
    entry.buffer.shift();
  }
  entry.buffer.push(event);
  entry.emitter.emit("data", event);
}

export function createFixtureSession(
  input: FixtureSessionInput,
): TerminalSession {
  const sessions = getTerminalSessions();
  const existing = sessions.get(input.id);
  if (existing) {
    return existing.session;
  }

  const knotsAgentInfo =
    input.agentName || input.agentModel
      || input.agentVersion || input.agentProvider
      ? {
          ...(input.agentName ? { agentName: input.agentName } : {}),
          ...(input.agentModel ? { agentModel: input.agentModel } : {}),
          ...(input.agentVersion ? { agentVersion: input.agentVersion } : {}),
          ...(input.agentProvider ? { agentProvider: input.agentProvider } : {}),
        }
      : undefined;
  const session: TerminalSession = {
    id: input.id,
    beatId: input.beatId,
    beatTitle: input.beatTitle,
    repoPath: input.repoPath,
    ...(input.knotsLeaseId ? { knotsLeaseId: input.knotsLeaseId } : {}),
    ...(knotsAgentInfo ? { knotsAgentInfo } : {}),
    status: "running",
    startedAt: input.startedAt ?? new Date().toISOString(),
  };
  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);

  const entry: SessionEntry = {
    session,
    process: null,
    emitter,
    buffer: [],
    interactionLog: noopInteractionLog(),
    abort: () => {
      session.status = "aborted";
      pushBufferedEvent(entry, {
        type: "exit",
        data: "130",
        timestamp: Date.now(),
      });
      setTimeout(() => {
        cleanupTerminalSessionResources(
          session.id,
          "fixture_aborted",
        );
      }, FIXTURE_CLEANUP_DELAY_MS);
    },
  };

  sessions.set(session.id, entry);
  return session;
}

export function emitFixtureEvent(
  sessionId: string,
  event: TerminalEvent,
): boolean {
  const entry = getTerminalSessions().get(sessionId);
  if (!entry) return false;

  if (event.type === "exit") {
    const exitCode = Number.parseInt(event.data, 10);
    entry.session.exitCode = Number.isNaN(exitCode)
      ? undefined
      : exitCode;
    entry.session.status = fixtureStatusForExit(exitCode);
  }

  pushBufferedEvent(entry, event);

  if (event.type === "exit") {
    setTimeout(() => {
      cleanupTerminalSessionResources(
        sessionId,
        "fixture_exit",
      );
    }, FIXTURE_CLEANUP_DELAY_MS);
  }

  return true;
}

export function clearFixtureSessions(): void {
  getTerminalSessions().clear();
  clearApprovalRegistry();
}
