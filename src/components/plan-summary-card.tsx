"use client";

import type { KeyboardEvent, MouseEvent } from "react";
import { CheckCircle2, GitBranch, Music4 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PlanSummary } from "@/lib/orchestration-plan-types";
import type { SetlistPlanPreview } from "@/lib/setlist-chart";
import { cn } from "@/lib/utils";

export interface PlanSummaryCardProps {
  plan: PlanSummary;
  preview: SetlistPlanPreview;
  selected: boolean;
  workableBeatCount: number;
  canComplete: boolean;
  isCompleting: boolean;
  onSelect: (planId: string) => void;
  onComplete: (planId: string) => void;
}

export function PlanSummaryCard(props: PlanSummaryCardProps) {
  const {
    plan,
    selected,
    workableBeatCount,
    canComplete,
    isCompleting,
    onSelect,
    onComplete,
  } = props;
  const isDone = workableBeatCount === 0;

  const handleSelect = () => onSelect(plan.artifact.id);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleSelect();
    }
  };
  const handleComplete = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onComplete(plan.artifact.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      data-testid="plan-summary-card"
      data-plan-id={plan.artifact.id}
      data-done={isDone ? "true" : "false"}
      className={cn(
        "flex h-full cursor-pointer flex-col rounded-xl border p-4 text-left transition-colors",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary/35 bg-primary/[0.03] shadow-sm"
          : "border-border/70 bg-card hover:border-primary/40 hover:bg-accent/30",
        isDone && "opacity-90",
      )}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
    >
      <PlanSummaryCardHeader
        planId={plan.artifact.id}
        selected={selected}
        isDone={isDone}
      />
      <PlanSummaryCardBody
        preview={props.preview}
        mode={plan.plan.mode ?? "groom"}
        workableBeatCount={workableBeatCount}
        isDone={isDone}
      />
      {canComplete && (
        <CompletePlanAction
          isCompleting={isCompleting}
          onClick={handleComplete}
        />
      )}
    </div>
  );
}

function PlanSummaryCardHeader({
  planId,
  selected,
  isDone,
}: {
  planId: string;
  selected: boolean;
  isDone: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Badge variant={selected ? "default" : "outline"}>
          {selected ? "Selected" : "Execution plan"}
        </Badge>
        {isDone && <DonePlanBadge />}
      </div>
      <span className="font-mono text-[11px] text-muted-foreground">
        {planId}
      </span>
    </div>
  );
}

function DonePlanBadge() {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "gap-1 border-moss-200 bg-moss-100 text-moss-700",
        "dark:border-moss-700 dark:bg-moss-700/30 dark:text-moss-200",
      )}
      data-testid="plan-done-badge"
    >
      <CheckCircle2 className="size-3" />
      Done
    </Badge>
  );
}

function PlanSummaryCardBody({
  preview,
  mode,
  workableBeatCount,
  isDone,
}: {
  preview: SetlistPlanPreview;
  mode: string;
  workableBeatCount: number;
  isDone: boolean;
}) {
  return (
    <div className="mt-3 space-y-2">
      <div>
        <p
          className={cn(
            "text-base font-semibold leading-tight",
            isDone && "text-muted-foreground line-through",
          )}
        >
          {preview.objective ?? "No objective captured."}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {preview.summary}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
          <Music4 className="size-3.5" />
          {workableBeatCount} remaining
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
          <GitBranch className="size-3.5" />
          {mode}
        </span>
      </div>
    </div>
  );
}

function CompletePlanAction({
  isCompleting,
  onClick,
}: {
  isCompleting: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="mt-3 flex">
      <Button
        type="button"
        variant="success"
        size="sm"
        data-testid="plan-complete-button"
        disabled={isCompleting}
        onClick={onClick}
      >
        <CheckCircle2 className="size-3.5" />
        {isCompleting ? "Completing…" : "Complete plan"}
      </Button>
    </div>
  );
}
