import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  defaultWorkflowDescriptor,
  resolveStep,
  StepPhase,
} from "@/lib/workflows";

const DEFAULT_WF = defaultWorkflowDescriptor();

/**
 * Category-based color mapping for workflow states.
 * Handles 15+ granular states via prefix/suffix matching.
 */
function stateColor(state: string): string {
  const s = state.trim().toLowerCase();

  // Terminal states
  if (s === "shipped") return "bg-moss-100 text-moss-700 dark:bg-moss-700 dark:text-moss-100";
  if (s === "abandoned" || s === "closed") return "bg-paper-200 text-ink-700 dark:bg-walnut-100 dark:text-paper-300";

  // Hold states
  if (s === "deferred") return "bg-paper-200 text-ink-600 dark:bg-walnut-100 dark:text-paper-400";
  if (s === "blocked") return "bg-rust-100 text-rust-700 dark:bg-rust-700 dark:text-rust-100";

  // Workflow step states
  const resolved = resolveStep(s, DEFAULT_WF);
  if (resolved) {
    if (resolved.phase === StepPhase.Queued) return "bg-lake-100 text-lake-700 dark:bg-lake-700 dark:text-lake-100";
    if (resolved.step.endsWith("_review")) return "bg-clay-100 text-clay-700 dark:bg-clay-700 dark:text-clay-100";
    return "bg-ochre-100 text-ochre-700 dark:bg-ochre-700 dark:text-ochre-100";
  }

  // Legacy compat
  if (s === "open") return "bg-lake-100 text-lake-700 dark:bg-lake-700 dark:text-lake-100";
  if (s === "in_progress") return "bg-ochre-100 text-ochre-700 dark:bg-ochre-700 dark:text-ochre-100";

  // Unknown state fallback
  return "bg-paper-200 text-ink-700 dark:bg-walnut-100 dark:text-paper-300";
}

const STATE_ABBREVIATIONS: Record<string, string> = {
  Implementation: "Impl",
};

function formatState(state: string): string {
  return (state ?? "open")
    .split("_")
    .map((w) => {
      const capped = w.charAt(0).toUpperCase() + w.slice(1);
      return STATE_ABBREVIATIONS[capped] ?? capped;
    })
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
