import type {
  ApplyBreakdownResult,
  BdResult,
  BreakdownEvent,
  BreakdownSession,
} from "@/lib/types";

const BASE = "/api/breakdown";

export async function startBreakdown(
  repo: string,
  parentBeatId: string
): Promise<BdResult<BreakdownSession>> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ _repo: repo, parentBeatId }),
  });

  const json = await res.json();
  if (!res.ok) {
    return { ok: false, error: json.error ?? "Failed to start breakdown" };
  }

  return { ok: true, data: json.data };
}

export async function abortBreakdown(
  sessionId: string
): Promise<BdResult<void>> {
  const res = await fetch(BASE, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });

  const json = await res.json();
  if (!res.ok) {
    return { ok: false, error: json.error ?? "Failed to abort breakdown" };
  }

  return { ok: true };
}

export async function applyBreakdown(
  sessionId: string,
  repo: string
): Promise<BdResult<ApplyBreakdownResult>> {
  const res = await fetch(`${BASE}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, _repo: repo }),
  });

  const json = await res.json();
  if (!res.ok) {
    return { ok: false, error: json.error ?? "Failed to apply breakdown" };
  }

  return { ok: true, data: json.data };
}

export function connectToBreakdown(
  sessionId: string,
  onEvent: (event: BreakdownEvent) => void,
  onError?: (event: Event) => void
): () => void {
  const es = new EventSource(`${BASE}/${sessionId}`);
  let gotExit = false;

  es.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as BreakdownEvent;
      if (event.type === "exit") gotExit = true;
      onEvent(event);
    } catch {
      // Ignore parse errors.
    }
  };

  es.onerror = (event) => {
    if (!gotExit) onError?.(event);
    es.close();
  };

  return () => es.close();
}
