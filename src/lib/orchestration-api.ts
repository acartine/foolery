import type {
  ApplyOrchestrationResult,
  ApplyOrchestrationOverrides,
  BdResult,
  OrchestrationEvent,
  OrchestrationSession,
} from "@/lib/types";

const BASE = "/api/orchestration";

export async function startOrchestration(
  repo: string,
  objective?: string
): Promise<BdResult<OrchestrationSession>> {
  const body: Record<string, string> = { _repo: repo };
  if (objective?.trim()) body.objective = objective.trim();

  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    return { ok: false, error: json.error ?? "Failed to start orchestration" };
  }

  return { ok: true, data: json.data };
}

export async function abortOrchestration(
  sessionId: string
): Promise<BdResult<void>> {
  const res = await fetch(BASE, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });

  const json = await res.json();
  if (!res.ok) {
    return { ok: false, error: json.error ?? "Failed to abort orchestration" };
  }

  return { ok: true };
}

export async function applyOrchestration(
  sessionId: string,
  repo: string,
  overrides?: ApplyOrchestrationOverrides
): Promise<BdResult<ApplyOrchestrationResult>> {
  const body: Record<string, unknown> = { sessionId, _repo: repo };
  if (overrides?.waveNames && Object.keys(overrides.waveNames).length > 0) {
    body.waveNames = overrides.waveNames;
  }
  if (overrides?.waveSlugs && Object.keys(overrides.waveSlugs).length > 0) {
    body.waveSlugs = overrides.waveSlugs;
  }

  const res = await fetch(`${BASE}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    return { ok: false, error: json.error ?? "Failed to apply orchestration" };
  }

  return { ok: true, data: json.data };
}

export function connectToOrchestration(
  sessionId: string,
  onEvent: (event: OrchestrationEvent) => void,
  onError?: (event: Event) => void
): () => void {
  const es = new EventSource(`${BASE}/${sessionId}`);
  let gotExit = false;

  es.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as OrchestrationEvent;
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
