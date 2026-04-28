import { connectToSession } from "./terminal-api";
import { invalidateBeatListQueries } from "@/lib/beat-query-cache";
import { useTerminalStore } from "@/stores/terminal-store";
import { useNotificationStore } from "@/stores/notification-store";
import { useApprovalEscalationStore } from "@/stores/approval-escalation-store";
import {
  approvalEscalationFromBanner,
  buildApprovalsHref,
  formatApprovalDetailText,
  formatApprovalPrimaryText,
  logApprovalEscalation,
  type ApprovalEscalation,
} from "@/lib/approval-escalations";
import type { TerminalEvent } from "./types";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export interface BufferedEvent {
  type: TerminalEvent["type"];
  data: string;
}

type EventListener = (event: TerminalEvent) => void;

interface Connection {
  close: () => void;
  listeners: Set<EventListener>;
  buffer: BufferedEvent[];
  exitReceived: boolean;
  exitCode: number | null;
}

const MAX_BUFFER = 5_000;

class SessionConnectionManager {
  private connections = new Map<string, Connection>();
  private storeUnsubscribe: (() => void) | null = null;
  private queryClient: QueryClient | null = null;

  /** Idempotent — creates SSE connection if not already connected. */
  connect(sessionId: string): void {
    if (this.connections.has(sessionId)) return;

    const conn: Connection = {
      close: () => {},
      listeners: new Set(),
      buffer: [],
      exitReceived: false,
      exitCode: null,
    };
    this.connections.set(sessionId, conn);

    const close = connectToSession(
      sessionId,
      (event: TerminalEvent) => {
        // Buffer the event (bounded)
        if (conn.buffer.length < MAX_BUFFER) {
          conn.buffer.push({ type: event.type, data: event.data });
        }

        // Forward to all live listeners
        for (const listener of conn.listeners) {
          listener(event);
        }

        if (handleApprovalEvent(event, sessionId)) {
          return;
        }

        if (event.type === "agent_switch") {
          try {
            const agent = JSON.parse(event.data);
            useTerminalStore.getState().updateAgent(sessionId, agent);
          } catch {
            // ignore malformed agent_switch data
          }
          return;
        }

        if (event.type === "beat_state_observed") {
          if (this.queryClient) {
            void invalidateBeatListQueries(this.queryClient);
          }
          return;
        }

        if (event.type === "agent_failure") {
          fireAgentFailureNotification(event.data, sessionId);
          return;
        }

        if (event.type === "exit") {
          handleExitEvent(
            event, conn, sessionId, this.queryClient,
          );
        }
      },
      // onError — remove the connection entry so sync can reconnect,
      // but do NOT write disconnect messages (the old UI bug).
      () => {
        this.connections.delete(sessionId);
      },
    );

    conn.close = close;
  }

  /** Close SSE and remove connection entry. */
  disconnect(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    conn.close();
    this.connections.delete(sessionId);
  }

  /**
   * Subscribe to live events for a session.
   * Returns an unsubscribe function.
   */
  subscribe(sessionId: string, listener: EventListener): () => void {
    const conn = this.connections.get(sessionId);
    if (!conn) return () => {};
    conn.listeners.add(listener);
    return () => {
      conn.listeners.delete(listener);
    };
  }

  /** Return buffered events for replay in xterm. */
  getBuffer(sessionId: string): BufferedEvent[] {
    return this.connections.get(sessionId)?.buffer ?? [];
  }

  /** Whether the session has received an exit event. */
  hasExited(sessionId: string): boolean {
    return this.connections.get(sessionId)?.exitReceived ?? false;
  }

  /** Get the exit code, or null if not yet exited. */
  getExitCode(sessionId: string): number | null {
    return this.connections.get(sessionId)?.exitCode ?? null;
  }

  /** List all currently-connected session IDs. */
  getConnectedIds(): string[] {
    return [...this.connections.keys()];
  }

  /**
   * Start syncing SSE connections with the terminal store.
   * Subscribes to zustand outside React — connections persist regardless
   * of which component is mounted or which tab is active.
   */
  startSync(queryClient: QueryClient): void {
    this.queryClient = queryClient;
    // Don't double-subscribe
    if (this.storeUnsubscribe) return;

    // Sync immediately for current state
    this.syncConnections();

    // Subscribe to future changes
    this.storeUnsubscribe = useTerminalStore.subscribe(() => {
      this.syncConnections();
    });
  }

  /** Stop syncing and disconnect all. */
  stopSync(): void {
    this.storeUnsubscribe?.();
    this.storeUnsubscribe = null;
    this.queryClient = null;
    for (const sessionId of [...this.connections.keys()]) {
      this.disconnect(sessionId);
    }
  }

  private syncConnections(): void {
    const { terminals } = useTerminalStore.getState();
    const runningIds = new Set(
      terminals
        .filter((t) => t.status === "running")
        .map((t) => t.sessionId),
    );

    // Connect to new running sessions
    for (const sessionId of runningIds) {
      this.connect(sessionId);
    }

    // Disconnect sessions no longer running in the store
    for (const sessionId of this.connections.keys()) {
      if (!runningIds.has(sessionId)) {
        // Only disconnect if exit was already received — otherwise
        // keep the connection alive so we don't miss the exit event.
        const conn = this.connections.get(sessionId);
        if (conn?.exitReceived) {
          this.disconnect(sessionId);
        }
      }
    }
  }
}

/** Singleton instance */
export const sessionConnections = new SessionConnectionManager();

function handleApprovalEvent(
  event: TerminalEvent,
  sessionId: string,
): boolean {
  if (event.type !== "stdout" && event.type !== "stderr") {
    return false;
  }
  const terminal = useTerminalStore
    .getState()
    .terminals.find((t) => t.sessionId === sessionId);
  const approval = approvalEscalationFromBanner(
    event.data,
    {
      sessionId,
      beatId: terminal?.beatId,
      beatTitle: terminal?.beatTitle,
      repoPath: terminal?.repoPath,
      timestamp: event.timestamp,
    },
  );
  if (!approval) return false;
  logApprovalEscalation("approval.detected", {
    approvalId: approval.id,
    notificationKey: approval.notificationKey,
    sessionId: approval.sessionId,
    beatId: approval.beatId,
    repoPath: approval.repoPath,
    adapter: approval.adapter,
    source: approval.source,
    serverName: approval.serverName,
    toolName: approval.toolName,
    status: approval.status,
  });
  const created = useApprovalEscalationStore
    .getState()
    .upsertPendingApproval(approval);
  if (!created) return true;
  fireApprovalNotification(approval);
  return true;
}

function fireApprovalNotification(
  approval: ApprovalEscalation,
): void {
  const href = buildApprovalsHref(approval.repoPath);
  const detail = formatApprovalDetailText(approval);
  useNotificationStore.getState().addNotification({
    kind: "approval",
    message:
      `Approval required: ${formatApprovalPrimaryText(approval)}`,
    beatId: approval.beatId,
    repoPath: approval.repoPath,
    href,
    dedupeKey: approval.notificationKey,
  });
  toast.warning("Approval required", {
    description: detail,
    action: {
      label: "Open approvals",
      onClick: () => {
        window.location.href = href;
      },
    },
  });
  logApprovalEscalation("approval.notification_emitted", {
    approvalId: approval.id,
    notificationKey: approval.notificationKey,
    sessionId: approval.sessionId,
    beatId: approval.beatId,
    repoPath: approval.repoPath,
    adapter: approval.adapter,
    source: approval.source,
    serverName: approval.serverName,
    toolName: approval.toolName,
    status: approval.status,
  });
}

function handleExitEvent(
  event: TerminalEvent,
  conn: Connection,
  sessionId: string,
  queryClient: QueryClient | null,
): void {
  if (conn.exitReceived) return;
  conn.exitReceived = true;
  conn.exitCode = parseInt(event.data, 10);
  const isDisconnect = conn.exitCode === -2;
  const currentTerminal = useTerminalStore
    .getState()
    .terminals.find((t) => t.sessionId === sessionId);
  const alreadyAborted =
    currentTerminal?.status === "aborted";
  if (!alreadyAborted) {
    useTerminalStore.getState().updateStatus(
      sessionId,
      isDisconnect
        ? "disconnected"
        : conn.exitCode === 0
          ? "completed"
          : "error",
    );
  }
  const terminal = currentTerminal ?? useTerminalStore
    .getState()
    .terminals.find((t) => t.sessionId === sessionId);
  if (terminal) {
    fireExitNotification(
      conn, terminal, alreadyAborted, isDisconnect,
    );
  }
  if (queryClient) {
    void invalidateBeatListQueries(queryClient);
  }
}

function fireExitNotification(
  conn: Connection,
  terminal: { beatTitle: string; beatId?: string; repoPath?: string },
  alreadyAborted: boolean,
  isDisconnect: boolean,
): void {
  const status = alreadyAborted
    ? "terminated"
    : isDisconnect
      ? "disconnected (server may have restarted)"
      : conn.exitCode === 0
        ? "completed"
        : "exited with error";
  let errorDetail = "";
  if (conn.exitCode !== 0 && !isDisconnect) {
    const stderrEvents = conn.buffer.filter(
      (e) => e.type === "stderr",
    );
    const lastStderr = stderrEvents
      .slice(-3)
      .map((e) => e.data.trim())
      .filter(Boolean)
      .join(" ")
      .slice(0, 200);
    errorDetail = lastStderr
      ? ` — ${lastStderr}`
      : ` (exit code ${conn.exitCode}, no error output captured)`;
  }
  useNotificationStore.getState().addNotification({
    message:
      `"${terminal.beatTitle}" session ${status}${errorDetail}`,
    beatId: terminal.beatId,
    repoPath: terminal.repoPath,
  });
}

interface AgentFailurePayload {
  kind?: string;
  message?: string;
  beatId?: string;
}

function fireAgentFailureNotification(
  data: string, sessionId: string,
): void {
  let payload: AgentFailurePayload = {};
  try {
    payload = JSON.parse(data) as AgentFailurePayload;
  } catch {
    payload = { message: data };
  }
  const terminal = useTerminalStore
    .getState()
    .terminals.find((t) => t.sessionId === sessionId);
  const title = terminal
    ? `"${terminal.beatTitle}"`
    : "Take session";
  const kindLabel = payload.kind
    ? `[${payload.kind}] `
    : "";
  const message = payload.message ?? "Agent failure";
  useNotificationStore.getState().addNotification({
    message: `${kindLabel}${title}: ${message}`,
    beatId: payload.beatId ?? terminal?.beatId,
    repoPath: terminal?.repoPath,
  });
}
