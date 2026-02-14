import type {
  ApplyOrchestrationResult,
  OrchestrationPlan,
  OrchestrationSession,
} from "@/lib/types";
import type { LogLine } from "@/components/orchestration-view";

export const ORCHESTRATION_VIEW_STATE_KEY = "foolery:orchestration:view-state";

const STALE_MS = 30 * 60 * 1000; // 30 minutes

export interface OrchestrationViewState {
  session: OrchestrationSession | null;
  plan: OrchestrationPlan | null;
  objective: string;
  waveEdits: Record<number, { name: string; slug: string }>;
  statusText: string;
  logLines: LogLine[];
  applyResult: ApplyOrchestrationResult | null;
  repoPath: string;
  savedAt: number;
}

export function saveOrchestrationViewState(
  state: OrchestrationViewState
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      ORCHESTRATION_VIEW_STATE_KEY,
      JSON.stringify(state)
    );
  } catch {
    // sessionStorage full or unavailable — silently ignore
  }
}

export function loadOrchestrationViewState(
  repoPath: string
): OrchestrationViewState | null {
  if (typeof window === "undefined") return null;

  const raw = window.sessionStorage.getItem(ORCHESTRATION_VIEW_STATE_KEY);
  if (!raw) return null;

  let state: OrchestrationViewState;
  try {
    state = JSON.parse(raw) as OrchestrationViewState;
  } catch {
    window.sessionStorage.removeItem(ORCHESTRATION_VIEW_STATE_KEY);
    return null;
  }

  // Discard stale state
  if (Date.now() - state.savedAt > STALE_MS) {
    window.sessionStorage.removeItem(ORCHESTRATION_VIEW_STATE_KEY);
    return null;
  }

  // Discard if repo doesn't match
  if (state.repoPath !== repoPath) {
    return null;
  }

  return state;
}

export function clearOrchestrationViewState(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(ORCHESTRATION_VIEW_STATE_KEY);
}
