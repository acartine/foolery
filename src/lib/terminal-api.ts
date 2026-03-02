import type { TerminalSession, TerminalEvent, BdResult } from "./types";

const BASE = "/api/terminal";

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

export function connectToSession(
  sessionId: string,
  onEvent: (event: TerminalEvent) => void,
  onError?: (error: Event) => void
): () => void {
  const es = new EventSource(`${BASE}/${sessionId}`);
  let gotExit = false;

  es.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data) as TerminalEvent;
      if (event.type === "exit") gotExit = true;
      onEvent(event);
    } catch {
      // ignore parse errors
    }
  };

  es.onerror = (err) => {
    // Stream closing after exit is normal, not an error
    if (!gotExit) {
      onError?.(err);
    }
    es.close();
  };

  return () => es.close();
}
