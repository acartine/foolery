import type {
  ApplyHydrationResult,
  BdResult,
  HydrationEvent,
  HydrationSession,
} from "@/lib/types";

const BASE = "/api/hydration";

export async function startHydration(
  repo: string,
  parentBeadId: string
): Promise<BdResult<HydrationSession>> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ _repo: repo, parentBeadId }),
  });

  const json = await res.json();
  if (!res.ok) {
    return { ok: false, error: json.error ?? "Failed to start hydration" };
  }

  return { ok: true, data: json.data };
}

export async function abortHydration(
  sessionId: string
): Promise<BdResult<void>> {
  const res = await fetch(BASE, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });

  const json = await res.json();
  if (!res.ok) {
    return { ok: false, error: json.error ?? "Failed to abort hydration" };
  }

  return { ok: true };
}

export async function applyHydration(
  sessionId: string,
  repo: string
): Promise<BdResult<ApplyHydrationResult>> {
  const res = await fetch(`${BASE}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, _repo: repo }),
  });

  const json = await res.json();
  if (!res.ok) {
    return { ok: false, error: json.error ?? "Failed to apply hydration" };
  }

  return { ok: true, data: json.data };
}

export function connectToHydration(
  sessionId: string,
  onEvent: (event: HydrationEvent) => void,
  onError?: (event: Event) => void
): () => void {
  const es = new EventSource(`${BASE}/${sessionId}`);
  let gotExit = false;

  es.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as HydrationEvent;
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
