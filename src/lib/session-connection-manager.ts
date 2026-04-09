import { connectToSession } from "./terminal-api";
import { invalidateBeatListQueries } from "@/lib/beat-query-cache";
import { useTerminalStore } from "@/stores/terminal-store";
import { useNotificationStore } from "@/stores/notification-store";
import type { TerminalEvent } from "./types";
import type { QueryClient } from "@tanstack/react-query";

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

        if (event.type === "agent_switch") {
          try {
            const agent = JSON.parse(event.data);
            useTerminalStore.getState().updateAgent(sessionId, agent);
          } catch {
            // ignore malformed agent_switch data
          }
          return;
        }

        if (event.type === "exit") {
          // Exit is terminal; ignore duplicate exit events from reconnect/replay.
          if (conn.exitReceived) return;
          conn.exitReceived = true;
          conn.exitCode = parseInt(event.data, 10);

          // Sentinel -2 means the session vanished from the backend
          // (server crash / restart) — NOT a clean completion.
          const isDisconnect = conn.exitCode === -2;

          // If the store already shows "aborted" (set by the terminate
          // action), preserve that status instead of overwriting it with
          // completed/error derived from the exit code.
          const currentTerminal = useTerminalStore
            .getState()
            .terminals.find((t) => t.sessionId === sessionId);
          const alreadyAborted = currentTerminal?.status === "aborted";

          // Update zustand store directly — outside React lifecycle
          if (!alreadyAborted) {
            useTerminalStore
              .getState()
              .updateStatus(
                sessionId,
                isDisconnect
                  ? "disconnected"
                  : conn.exitCode === 0
                    ? "completed"
                    : "error",
              );
          }

          // Fire in-app notification for session exit
          const terminal = currentTerminal ?? useTerminalStore
            .getState()
            .terminals.find((t) => t.sessionId === sessionId);
          if (terminal) {
            const { addNotification } = useNotificationStore.getState();
            const status = alreadyAborted
              ? "terminated"
              : isDisconnect
                ? "disconnected (server may have restarted)"
                : conn.exitCode === 0
                  ? "completed"
                  : "exited with error";

            // Extract last stderr content for error context
            let errorDetail = "";
            if (conn.exitCode !== 0 && !isDisconnect) {
              const stderrEvents = conn.buffer.filter((e) => e.type === "stderr");
              const lastStderr = stderrEvents
                .slice(-3)
                .map((e) => e.data.trim())
                .filter(Boolean)
                .join(" ")
                .slice(0, 200);
              if (lastStderr) {
                errorDetail = ` — ${lastStderr}`;
              } else {
                errorDetail = ` (exit code ${conn.exitCode}, no error output captured)`;
              }
            }

            addNotification({
              message: `"${terminal.beatTitle}" session ${status}${errorDetail}`,
              beatId: terminal.beatId,
              repoPath: terminal.repoPath,
            });
          }

          if (this.queryClient) {
            void invalidateBeatListQueries(this.queryClient);
          }
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
