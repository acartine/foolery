"use client";

import { Info, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StaleBeatGroomingDispatchHelperProps {
  onOpenDispatchSettings: () => void;
}

export function StaleBeatGroomingDispatchHelper({
  onOpenDispatchSettings,
}: StaleBeatGroomingDispatchHelperProps) {
  return (
    <div className={
      "flex min-w-0 flex-1 flex-wrap items-center gap-2 "
      + "rounded-md border border-border bg-muted/35 px-2 py-1.5"
    }>
      <Info className="size-3.5 shrink-0 text-muted-foreground" />
      <p className="min-w-[220px] flex-1 text-xs text-muted-foreground">
        Set model dispatch to remember the stale-beat review model.
        Skipping that is fine; choose a model here for one review.
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 text-xs"
        onClick={onOpenDispatchSettings}
      >
        <Settings2 className="size-3.5" />
        Open Dispatch
      </Button>
    </div>
  );
}
