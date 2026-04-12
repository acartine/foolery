import { EventEmitter } from "node:events";
import { getBackend } from "@/lib/backend-instance";
import {
  startInteractionLog,
  noopInteractionLog,
  type InteractionLog,
} from "@/lib/interaction-logger";
import {
  getActionAgent,
  getStepAgent,
  loadSettings,
} from "@/lib/settings";
import type { CliAgentTarget } from "@/lib/types-agent-target";
import {
  normalizeAgentIdentity,
  toExecutionAgentInfo,
} from "@/lib/agent-identity";
import { wrapExecutionPrompt } from "@/lib/agent-prompt-guardrails";
import {
  ensureKnotsLease,
  logAttachedKnotsLease,
  terminateKnotsRuntimeLease,
} from "@/lib/knots-lease-runtime";
import {
  recordLeaseReleaseLifecycle,
} from "@/lib/terminal-manager-take-lifecycle";
import { recordStepAgent } from "@/lib/agent-pool";
import { validateCwd } from "@/lib/validate-cwd";
import type {
  TerminalSession,
  TerminalEvent,
} from "@/lib/types";
import {
  spawnInitialChild,
} from "@/lib/terminal-manager-initial-child";
import {
  terminateProcessGroup,
} from "@/lib/agent-session-runtime";
import {
  getTerminalSessions,
} from "@/lib/terminal-session-registry";
import type {
  SessionEntry,
} from "@/lib/terminal-manager-types";
import {
  type PreparedTargets,
  prepareSessionTargets,
} from "@/lib/terminal-manager-session-prep";

// Re-export public symbols for API compatibility.
export type {
  JsonObject,
} from "@/lib/terminal-manager-format";
export type {
  WorkflowPromptTarget,
} from "@/lib/terminal-manager-workflow";
export {
  type SessionEntry,
  INPUT_CLOSE_GRACE_MS,
  resolveAgentCommand,
} from "@/lib/terminal-manager-types";
export type {
  PreparedTargets,
} from "@/lib/terminal-manager-session-prep";


const MAX_BUFFER = 5000;
const DEFAULT_MAX_SESSIONS = 5;
const CLEANUP_DELAY_MS = 5 * 60 * 1000;

const sessions = getTerminalSessions();

function generateId(): string {
  return (
    `term-${Date.now()}-` +
    `${Math.random().toString(36).slice(2, 8)}`
  );
}

export function getSession(
  id: string,
): SessionEntry | undefined {
  return sessions.get(id);
}

export function listSessions(): TerminalSession[] {
  return Array.from(sessions.values()).map(
    (e) => e.session,
  );
}

// ─── createSession ───────────────────────────────────

export async function createSession(
  beatId: string,
  repoPath?: string,
  customPrompt?: string,
): Promise<TerminalSession> {
  const settings = await loadSettings();
  const maxSessions =
    settings.maxConcurrentSessions ??
    DEFAULT_MAX_SESSIONS;
  const running = Array.from(sessions.values()).filter(
    (e) => e.session.status === "running",
  );
  if (running.length >= maxSessions) {
    throw new Error(
      `Max concurrent sessions ` +
      `(${maxSessions}) reached`,
    );
  }

  const prepared = await prepareSessionTargets(
    beatId, repoPath,
  );
  const agent = await resolveSessionAgent(
    prepared, beatId,
  );
  const agentInfo = toExecutionAgentInfo(agent);

  if (prepared.resolved && agent.agentId) {
    recordStepAgent(
      beatId, prepared.resolved.step, agent.agentId,
    );
  }

  const id = generateId();
  const session = buildSession(
    id, prepared, agent,
  );

  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);
  const buffer: TerminalEvent[] = [];
  const interactionLog = await startSessionLog(
    id, prepared, agent,
  );

  const entry: SessionEntry = {
    session, process: null,
    emitter, buffer, interactionLog,
  };
  sessions.set(id, entry);
  await setupKnotsLease(entry, id, prepared, agentInfo);

  const prompt = await resolveSessionPrompt(
    customPrompt, prepared, entry,
  );

  const pushEvent = (evt: TerminalEvent) => {
    if (buffer.length >= MAX_BUFFER) buffer.shift();
    buffer.push(evt);
    emitter.emit("data", evt);
  };

  logRollbackEvents(
    prepared.healedTargets, pushEvent, interactionLog,
  );

  const cwdError = await validateCwd(
    prepared.resolvedRepoPath,
  );
  if (cwdError) {
    return handleCwdError(
      entry, session, id,
      prepared.resolvedRepoPath,
      cwdError, interactionLog, pushEvent,
    );
  }

  logSessionStart(
    id, beatId, prepared.resolvedRepoPath, prompt,
  );

  return spawnInitialChild(
    id, beatId, prepared, agent, agentInfo,
    session, entry, emitter, buffer,
    interactionLog, pushEvent, prompt,
    customPrompt, sessions,
  );
}

// ─── createSession sub-helpers ───────────────────────

async function resolveSessionAgent(
  prepared: PreparedTargets,
  beatId: string,
): Promise<CliAgentTarget> {
  return prepared.resolved
    ? await getStepAgent(
      prepared.resolved.step, "take", beatId,
    )
    : await getActionAgent("take");
}

function buildSession(
  id: string,
  prepared: PreparedTargets,
  agent: CliAgentTarget,
): TerminalSession {
  return {
    id,
    beatId: prepared.beat.id,
    beatTitle: prepared.beat.title,
    repoPath: prepared.resolvedRepoPath,
    agentName: toExecutionAgentInfo(agent).agentName,
    agentModel: agent.model,
    agentVersion: agent.version,
    ...(agent.kind === "cli"
      ? { agentCommand: agent.command }
      : {}),
    status: "running",
    startedAt: new Date().toISOString(),
  };
}

async function startSessionLog(
  id: string,
  prepared: PreparedTargets,
  agent: CliAgentTarget,
): Promise<InteractionLog> {
  return startInteractionLog({
    sessionId: id,
    interactionType: prepared.effectiveParent
      ? "scene" : "take",
    repoPath: prepared.resolvedRepoPath,
    beatIds: prepared.effectiveParent
      ? prepared.waveBeatIds
      : [prepared.beat.id],
    agentName: toExecutionAgentInfo(agent).agentName,
    agentProvider: normalizeAgentIdentity(agent).provider,
    agentModel: agent.model,
    agentVersion: agent.version,
  }).catch((err) => {
    console.error(
      `[terminal-manager] Failed to start ` +
      `interaction log:`, err,
    );
    return noopInteractionLog();
  });
}

async function setupKnotsLease(
  entry: SessionEntry,
  id: string,
  prepared: PreparedTargets,
  agentInfo: ReturnType<typeof toExecutionAgentInfo>,
): Promise<void> {
  let started = false;
  entry.releaseKnotsLease = (
    reason: string,
    outcome:
      | "success" | "warning" | "error" = "warning",
    data?: Record<string, unknown>,
  ) => {
    if (started) return;
    started = true;
    const knotsLeaseId = entry.knotsLeaseId;
    if (!knotsLeaseId) return;
    recordLeaseReleaseLifecycle(
      entry,
      entry.interactionLog,
      id,
      prepared.beat.id,
      reason,
      outcome,
      data,
    );
    entry.lastReleasedKnotsLeaseId = knotsLeaseId;
    entry.knotsLeaseId = undefined;
    entry.knotsLeaseStep = undefined;
    entry.knotsLeaseAgentInfo = undefined;
    void terminateKnotsRuntimeLease({
      repoPath: prepared.resolvedRepoPath,
      source: "terminal_manager_take",
      sessionId: id,
      knotsLeaseId,
      beatId: prepared.beat.id,
      interactionType: prepared.effectiveParent
        ? "scene" : "take",
      agentInfo, reason, outcome, data,
    });
  };

  if (
    prepared.memoryManagerType === "knots" &&
    !prepared.effectiveParent
  ) {
    await acquireKnotsLease(
      entry, id, prepared, agentInfo,
    );
  }
}

async function acquireKnotsLease(
  entry: SessionEntry,
  id: string,
  prepared: PreparedTargets,
  agentInfo: ReturnType<typeof toExecutionAgentInfo>,
): Promise<void> {
  const knotsLeaseId = await ensureKnotsLease({
    repoPath: prepared.resolvedRepoPath,
    source: "terminal_manager_take",
    sessionId: id,
    beatId: prepared.beat.id,
    interactionType: "take",
    agentInfo,
  });
  entry.knotsLeaseId = knotsLeaseId;
  entry.knotsLeaseSeq = (entry.knotsLeaseSeq ?? 0) + 1;
  entry.knotsLeaseStep = prepared.resolved?.step;
  entry.knotsLeaseAgentInfo = agentInfo;
  logAttachedKnotsLease({
    repoPath: prepared.resolvedRepoPath,
    source: "terminal_manager_take",
    sessionId: id,
    beatId: prepared.beat.id,
    interactionType: "take",
    agentInfo, knotsLeaseId,
  });
}

async function resolveSessionPrompt(
  customPrompt: string | undefined,
  prepared: PreparedTargets,
  entry: SessionEntry,
): Promise<string> {
  if (customPrompt) return customPrompt;
  const r = await getBackend().buildTakePrompt(
    prepared.beat.id,
    {
      isParent: prepared.effectiveParent,
      childBeatIds:
        prepared.effectiveParent &&
        prepared.waveBeatIds.length > 0
          ? prepared.waveBeatIds
          : undefined,
      knotsLeaseId: entry.knotsLeaseId,
    },
    prepared.repoPath,
  );
  if (!r.ok || !r.data) {
    throw new Error(
      r.error?.message ??
      "Failed to build take prompt",
    );
  }
  const mode = prepared.effectiveParent
    ? "scene" : "take";
  return wrapExecutionPrompt(r.data.prompt, mode);
}

function logRollbackEvents(
  healedTargets: PreparedTargets["healedTargets"],
  pushEvent: (evt: TerminalEvent) => void,
  interactionLog: InteractionLog,
): void {
  for (const healed of healedTargets) {
    if (!healed.rolledBack) continue;
    pushEvent({
      type: "stdout",
      data: `\x1b[33m--- Pre-dispatch rollback: ` +
        `${healed.beat.id} rolled back from ` +
        `"${healed.fromState}" to ` +
        `"${healed.toState}" ---\x1b[0m\n`,
      timestamp: Date.now(),
    });
    interactionLog.logBeatState({
      beatId: healed.beat.id,
      state: healed.toState!,
      phase: "rollback",
      label: `pre-dispatch rollback from ` +
        `${healed.fromState}`,
    });
  }
}

function handleCwdError(
  entry: SessionEntry,
  session: TerminalSession,
  id: string,
  cwd: string,
  cwdError: string,
  interactionLog: InteractionLog,
  pushEvent: (evt: TerminalEvent) => void,
): TerminalSession {
  console.error(
    `[terminal-manager] CWD validation failed ` +
    `for session ${id}: ${cwd}`,
  );
  session.status = "error";
  interactionLog.logEnd(1, "error");
  pushEvent({
    type: "stderr",
    data: `${cwdError}\n`,
    timestamp: Date.now(),
  });
  pushEvent({
    type: "exit", data: "1", timestamp: Date.now(),
  });
  entry.releaseKnotsLease?.(
    "invalid_cwd", "error", { cwdError },
  );
  setTimeout(
    () => { entry.emitter.removeAllListeners(); },
    2000,
  );
  setTimeout(() => {
    entry.buffer.length = 0;
    sessions.delete(id);
  }, CLEANUP_DELAY_MS);
  return session;
}

function logSessionStart(
  id: string,
  beatId: string,
  cwd: string,
  prompt: string,
): void {
  console.log(
    `[terminal-manager] Creating session ${id}`,
  );
  console.log(
    `[terminal-manager]   beatId: ${beatId}`,
  );
  console.log(
    `[terminal-manager]   cwd: ${cwd}`,
  );
  console.log(
    `[terminal-manager]   prompt: ` +
    `${prompt.slice(0, 120)}...`,
  );
}

// ─── abortSession ────────────────────────────────────

export function abortSession(id: string): boolean {
  const entry = sessions.get(id);
  if (!entry) return false;

  entry.session.status = "aborted";
  if (entry.abort) entry.abort();

  if (!entry.process) {
    entry.releaseKnotsLease?.(
      "abort_without_process", "warning",
    );
    return entry.abort != null;
  }

  terminateProcessGroup(entry.process);
  return true;
}
