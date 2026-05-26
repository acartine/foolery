import type {
  ApprovalAction,
  ApprovalEscalationStatus,
} from "@/lib/approval-actions";
import type { TerminalSession, TerminalEvent, BdResult } from "./types";
import { withClientPerfSpan } from "@/lib/client-perf";

const BASE = "/api/terminal";

export interface TerminalStreamEnvelope {
  sessionId: string;
  event: TerminalEvent;
}

export async function listSessions(): Promise<TerminalSession[]> {
  try {
    return await withClientPerfSpan("api", BASE, async () => {
      const res = await fetch(BASE);
      if (!res.ok) return [];
      const json = await res.json();
      return json.data ?? [];
    }, () => ({ method: "GET" }));
  } catch {
    return [];
  }
}

export async function startSession(
  beatId: string,
  repo?: string,
  prompt?: string
): Promise<BdResult<TerminalSession>> {
  const body: Record<string, string> = { beatId };
  if (repo) body._repo = repo;
  if (prompt) body.prompt = prompt;

  return withClientPerfSpan("api", `${BASE}/start`, async () => {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error ?? "Failed to start session" };
    return { ok: true, data: json.data };
  }, () => ({ method: "POST", meta: { beatId, repo } }));
}

export async function abortSession(sessionId: string): Promise<BdResult<void>> {
  return withClientPerfSpan("api", `${BASE}/abort`, async () => {
    const res = await fetch(BASE, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error ?? "Failed to abort session" };
    return { ok: true };
  }, () => ({ method: "DELETE", meta: { sessionId } }));
}

export interface ApprovalActionResponse {
  approvalId: string;
  action: ApprovalAction;
  status: ApprovalEscalationStatus;
}

export async function sendApprovalAction(
  sessionId: string,
  approvalId: string,
  action: ApprovalAction,
): Promise<BdResult<ApprovalActionResponse>> {
  return withClientPerfSpan(
    "api",
    `${BASE}/${sessionId}/approvals/${approvalId}`,
    async () => {
      const res = await fetch(
        `${BASE}/${encodeURIComponent(sessionId)}` +
          `/approvals/${encodeURIComponent(approvalId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        return {
          ok: false,
          error: json.error ?? "Failed to send approval action",
        };
      }
      return { ok: true, data: json.data };
    },
    () => ({ method: "POST", meta: { sessionId, approvalId, action } }),
  );
}

export async function sendApprovalRespond(
  sessionId: string,
  approvalId: string,
  text: string,
): Promise<BdResult<ApprovalActionResponse>> {
  return withClientPerfSpan(
    "api",
    `${BASE}/${sessionId}/approvals/${approvalId}/respond`,
    async () => {
      const res = await fetch(
        `${BASE}/${encodeURIComponent(sessionId)}` +
          `/approvals/${encodeURIComponent(approvalId)}/respond`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        return {
          ok: false,
          error: json.error ?? "Failed to send approval response",
        };
      }
      return { ok: true, data: json.data };
    },
    () => ({
      method: "POST",
      meta: { sessionId, approvalId, action: "respond" as const },
    }),
  );
}

async function fetchSessionStatus(
  sessionId: string,
): Promise<TerminalSession | null> {
  try {
    const sessions = await listSessions();
    return sessions.find((s) => s.id === sessionId) ?? null;
  } catch {
    return null;
  }
}

async function fetchSessionStatusMap(
  sessionIds: Set<string>,
): Promise<Map<string, TerminalSession>> {
  try {
    const sessions = await listSessions();
    return new Map(
      sessions
        .filter((s) => sessionIds.has(s.id))
        .map((s) => [s.id, s]),
    );
  } catch {
    return new Map();
  }
}

function exitCodeForSession(session: TerminalSession | null): string {
  if (!session) return "-2";
  if (session.status === "disconnected") return "-2";
  return String(
    session.exitCode ?? (session.status === "completed" ? 0 : 1),
  );
}

function isTerminalStatus(session: TerminalSession | null): boolean {
  return !session
    || (session.status !== "running" && session.status !== "idle");
}

function uniqueSessionIds(sessionIds: string[]): string[] {
  return [...new Set(sessionIds.filter(Boolean))].sort();
}

export function connectToSession(
  sessionId: string,
  onEvent: (event: TerminalEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  const es = new EventSource(`${BASE}/${sessionId}`);
  let gotExit = false;
  let gotStreamEnd = false;

  es.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data) as TerminalEvent;
      if (event.type === "exit") gotExit = true;
      // Server sends stream_end right before a clean close; swallow it.
      if (event.type === "stream_end") {
        gotStreamEnd = true;
        return;
      }
      onEvent(event);
    } catch {
      // ignore parse errors
    }
  };

  es.onerror = (err) => {
    // Stream closing after exit or clean server shutdown is not an error.
    if (gotExit || gotStreamEnd) {
      es.close();
      return;
    }
    // Defer briefly so any pending onmessage (exit) can run first.
    // EventSource fires queued messages before onerror, but a server-
    // initiated close can race with the last data frame at the TCP level.
    setTimeout(async () => {
      if (gotExit || gotStreamEnd) {
        es.close();
        return;
      }
      // Poll backend to recover from missed exit events
      const session = await fetchSessionStatus(sessionId);
      if (session && session.status !== "running") {
        const exitCode =
          session.status === "disconnected"
            ? -2
            : session.exitCode ?? (session.status === "completed" ? 0 : 1);
        onEvent({
          type: "exit",
          data: String(exitCode),
          timestamp: Date.now(),
        });
      } else if (!session) {
        // Session gone from backend — server likely restarted/crashed.
        // Use sentinel exit code -2 so callers can distinguish from clean exit.
        onEvent({ type: "exit", data: "-2", timestamp: Date.now() });
      } else {
        onError?.(err);
      }
      es.close();
    }, 200);
  };

  return () => es.close();
}

export function connectToSessionEvents(
  sessionIds: string[],
  onEvent: (sessionId: string, event: TerminalEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  const ids = uniqueSessionIds(sessionIds);
  if (ids.length === 0) return () => {};

  const qs = ids.map(encodeURIComponent).join(",");
  const es = new EventSource(`${BASE}/events?sessionIds=${qs}`);
  const state = {
    expectedIds: new Set(ids),
    endedIds: new Set<string>(),
  };

  es.onmessage = (msg) => {
    try {
      const envelope = JSON.parse(msg.data) as TerminalStreamEnvelope;
      const event = envelope.event;
      if (event.type === "exit") state.endedIds.add(envelope.sessionId);
      if (event.type === "stream_end") {
        state.endedIds.add(envelope.sessionId);
        return;
      }
      onEvent(envelope.sessionId, event);
    } catch {
      // ignore parse errors
    }
  };

  es.onerror = (err) => {
    if (allExpectedIdsEnded(state)) {
      es.close();
      return;
    }
    setTimeout(() => {
      void recoverSessionEventsDisconnect(es, state, err, onEvent, onError);
    }, 200);
  };

  return () => es.close();
}

function allExpectedIdsEnded(state: {
  expectedIds: Set<string>;
  endedIds: Set<string>;
}): boolean {
  for (const sessionId of state.expectedIds) {
    if (!state.endedIds.has(sessionId)) return false;
  }
  return true;
}

async function recoverSessionEventsDisconnect(
  es: EventSource,
  state: { expectedIds: Set<string>; endedIds: Set<string> },
  err: Event,
  onEvent: (sessionId: string, event: TerminalEvent) => void,
  onError?: (error: Event) => void,
): Promise<void> {
  if (allExpectedIdsEnded(state)) {
    es.close();
    return;
  }
  const statuses = await fetchSessionStatusMap(state.expectedIds);
  let recoveredAll = true;
  for (const sessionId of state.expectedIds) {
    if (state.endedIds.has(sessionId)) continue;
    const session = statuses.get(sessionId) ?? null;
    if (!isTerminalStatus(session)) {
      recoveredAll = false;
      continue;
    }
    const event = {
      type: "exit",
      data: exitCodeForSession(session),
      timestamp: Date.now(),
    } satisfies TerminalEvent;
    state.endedIds.add(sessionId);
    onEvent(sessionId, event);
  }
  if (!recoveredAll) onError?.(err);
  es.close();
}
