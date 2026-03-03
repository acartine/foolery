import type { TerminalSession, TerminalEvent, BdResult } from "./types";

const BASE = "/api/terminal";

export async function listSessions(): Promise<TerminalSession[]> {
  try {
    const res = await fetch(BASE);
    if (!res.ok) return [];
    const json = await res.json();
    return json.data ?? [];
  } catch {
    return [];
  }
}

export async function startSession(
  beadId: string,
  repo?: string,
  prompt?: string
): Promise<BdResult<TerminalSession>> {
  const body: Record<string, string> = { beadId };
  if (repo) body._repo = repo;
  if (prompt) body.prompt = prompt;

  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) return { ok: false, error: json.error ?? "Failed to start session" };
  return { ok: true, data: json.data };
}

export async function abortSession(sessionId: string): Promise<BdResult<void>> {
  const res = await fetch(BASE, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  const json = await res.json();
  if (!res.ok) return { ok: false, error: json.error ?? "Failed to abort session" };
  return { ok: true };
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
      if (
        session &&
        (session.status === "completed" || session.status === "error")
      ) {
        onEvent({
          type: "exit",
          data: String(session.exitCode ?? 0),
          timestamp: Date.now(),
        });
      } else {
        onError?.(err);
      }
      es.close();
    }, 200);
  };

  return () => es.close();
}
