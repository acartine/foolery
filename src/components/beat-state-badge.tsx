import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { resolveStep, StepPhase } from "@/lib/workflows";

/**
 * Category-based color mapping for workflow states.
 * Handles 15+ granular states via prefix/suffix matching.
 */
function stateColor(state: string): string {
  const s = state.trim().toLowerCase();

  // Terminal states
  if (s === "shipped") return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
  if (s === "abandoned" || s === "closed") return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";

  // Hold states
  if (s === "deferred") return "bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-400";
  if (s === "blocked") return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";

  // Workflow step states
  const resolved = resolveStep(s);
  if (resolved) {
    if (resolved.phase === StepPhase.Queued) return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
    if (resolved.step.endsWith("_review")) return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300";
    return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
  }

  // Legacy compat
  if (s === "open") return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
  if (s === "in_progress") return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";

  // Unknown state fallback
  return "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300";
}

function formatState(state: string): string {
  return (state ?? "open")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function BeatStateBadge({
  state: rawState,
  className,
}: {
  state: string;
  className?: string;
}) {
  const state = rawState ?? "open";
  return (
    <Badge variant="outline" className={cn(stateColor(state), className)}>
      {formatState(state)}
    </Badge>
  );
}
