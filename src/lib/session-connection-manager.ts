import { connectToSessionEvents, listSessions } from "./terminal-api";
import { invalidateBeatListQueries } from "@/lib/beat-query-cache";
import { useTerminalStore } from "@/stores/terminal-store";
import { useNotificationStore } from "@/stores/notification-store";
import {
  approvalEscalationFromBanner,
} from "@/lib/approval-escalations";
import {
  enqueueApprovalEscalation,
} from "@/lib/approval-escalation-client";
import type { TerminalEvent } from "./types";
import type { QueryClient } from "@tanstack/react-query";

export interface BufferedEvent {
  type: TerminalEvent["type"];
  data: string;
}

type EventListener = (event: TerminalEvent) => void;

interface Connection {
  listeners: Set<EventListener>;
  buffer: BufferedEvent[];
  bufferBytes: number;
  exitReceived: boolean;
  exitCode: number | null;
}

export interface TerminalConnectionStats {
  sessionId: string;
  listenerCount: number;
  bufferEvents: number;
  bufferBytes: number;
  exited: boolean;
  streaming: boolean;
}

const MAX_BUFFER_EVENTS = 5_000;
const MAX_BUFFER_BYTES = 1_000_000;
const MAX_BUFFER_EVENT_CHARS = 64_000;

class SessionConnectionManager {
  private connections = new Map<string, Connection>();
  private storeUnsubscribe: (() => void) | null = null;
  private queryClient: QueryClient | null = null;
  private streamClose: (() => void) | null = null;
  private streamKey = "";

  /** Idempotent — tracks a session and refreshes the shared SSE stream. */
  connect(sessionId: string): void {
    if (this.connections.has(sessionId)) return;
    this.ensureConnection(sessionId);
    this.refreshStream();
  }

  private ensureConnection(sessionId: string): Connection {
    const existing = this.connections.get(sessionId);
    if (existing) return existing;
    const conn: Connection = {
      listeners: new Set(),
      buffer: [],
      bufferBytes: 0,
      exitReceived: false,
      exitCode: null,
    };
    this.connections.set(sessionId, conn);
    return conn;
  }

  /** Close SSE and remove connection entry. */
  disconnect(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    this.connections.delete(sessionId);
    this.refreshStream();
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

  getConnectionStats(): TerminalConnectionStats[] {
    const streamingIds = new Set(this.streamKey.split("\0").filter(Boolean));
    return [...this.connections.entries()].map(([sessionId, conn]) => ({
      sessionId,
      listenerCount: conn.listeners.size,
      bufferEvents: conn.buffer.length,
      bufferBytes: conn.bufferBytes,
      exited: conn.exitReceived,
      streaming: streamingIds.has(sessionId),
    }));
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
    this.closeSharedStream();
    this.connections.clear();
  }

  private syncConnections(): void {
    const { terminals } = useTerminalStore.getState();
    const runningIds = new Set(
      terminals
        .filter((t) => t.status === "running")
        .map((t) => t.sessionId),
    );

    // Track new running sessions; the shared SSE stream is refreshed once.
    for (const sessionId of runningIds) {
      this.ensureConnection(sessionId);
    }

    // Disconnect sessions no longer running in the store
    for (const sessionId of this.connections.keys()) {
      if (!runningIds.has(sessionId)) {
        // Only disconnect if exit was already received — otherwise
        // keep the connection alive so we don't miss the exit event.
        const conn = this.connections.get(sessionId);
        if (conn?.exitReceived) {
          this.connections.delete(sessionId);
        }
      }
    }
    this.refreshStream();
  }

  private refreshStream(): void {
    const sessionIds = [...this.connections.entries()]
      .filter(([, conn]) => !conn.exitReceived)
      .map(([sessionId]) => sessionId)
      .sort();
    const nextKey = sessionIds.join("\0");
    if (nextKey === this.streamKey) return;
    this.closeSharedStream();
    this.streamKey = nextKey;
    if (sessionIds.length === 0) return;
    this.streamClose = connectToSessionEvents(
      sessionIds,
      (sessionId, event) => this.handleEvent(sessionId, event),
      () => {
        this.streamKey = "";
        this.streamClose = null;
        this.refreshStream();
      },
    );
  }

  private closeSharedStream(): void {
    this.streamClose?.();
    this.streamClose = null;
    this.streamKey = "";
  }

  private handleEvent(sessionId: string, event: TerminalEvent): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;

    appendBufferedEvent(conn, event);
    for (const listener of conn.listeners) listener(event);

    if (handleApprovalEvent(event, sessionId)) return;
    if (event.type === "agent_switch") {
      void refreshLeaseFromBackend();
      return;
    }
    if (event.type === "beat_state_observed") {
      if (this.queryClient) void invalidateBeatListQueries(this.queryClient);
      return;
    }
    if (event.type === "agent_failure") {
      fireAgentFailureNotification(event.data, sessionId);
      return;
    }
    if (event.type === "exit") {
      handleExitEvent(event, conn, sessionId, this.queryClient);
      this.refreshStream();
    }
  }
}

/** Singleton instance */
export const sessionConnections = new SessionConnectionManager();
installDiagnosticsHook(sessionConnections);

function appendBufferedEvent(conn: Connection, event: TerminalEvent): void {
  const buffered = normalizeBufferedEvent(event);
  conn.buffer.push(buffered);
  conn.bufferBytes += estimateBufferedEventBytes(buffered);
  while (conn.buffer.length > MAX_BUFFER_EVENTS) {
    removeOldestBufferedEvent(conn);
  }
  while (conn.bufferBytes > MAX_BUFFER_BYTES && conn.buffer.length > 1) {
    removeOldestBufferedEvent(conn);
  }
}

function normalizeBufferedEvent(event: TerminalEvent): BufferedEvent {
  const data = event.data.length > MAX_BUFFER_EVENT_CHARS
    ? event.data.slice(-MAX_BUFFER_EVENT_CHARS)
    : event.data;
  return { type: event.type, data };
}

function removeOldestBufferedEvent(conn: Connection): void {
  const removed = conn.buffer.shift();
  if (!removed) return;
  conn.bufferBytes -= estimateBufferedEventBytes(removed);
}

function estimateBufferedEventBytes(event: BufferedEvent): number {
  return event.type.length + event.data.length;
}

declare global {
  interface Window {
    __FOOLERY_TERMINAL_CONNECTION_STATS__?: () => TerminalConnectionStats[];
  }
}

function installDiagnosticsHook(manager: SessionConnectionManager): void {
  if (typeof window === "undefined") return;
  if (!window.location.search.includes("diagnostics=1")) return;
  window.__FOOLERY_TERMINAL_CONNECTION_STATS__ = () => (
    manager.getConnectionStats()
  );
}

async function refreshLeaseFromBackend(): Promise<void> {
  try {
    const sessions = await listSessions();
    useTerminalStore.getState().rehydrateFromBackend(sessions);
  } catch {
    // best-effort; the next 5s rehydrate poll will pick up the change
  }
}

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
  enqueueApprovalEscalation(approval);
  return true;
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
