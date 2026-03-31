"use client";

import { LoaderCircle } from "lucide-react";

interface RepoSwitchLoadingStateProps {
  label: string;
  "data-testid"?: string;
}

export function RepoSwitchLoadingState({
  label,
  "data-testid": dataTestId,
}: RepoSwitchLoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid={dataTestId}
      className="rounded-xl border border-border/60 bg-muted/20 px-4 py-6"
    >
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        <span>{label}</span>
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-4 rounded-full bg-muted/80" />
        <div className="h-12 rounded-lg bg-muted/60" />
        <div className="h-12 rounded-lg bg-muted/60" />
        <div className="h-12 rounded-lg bg-muted/60" />
      </div>
    </div>
  );
}
