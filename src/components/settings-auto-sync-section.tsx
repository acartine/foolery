"use client";

import { RefreshCw } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function SettingsAutoSyncSection({
  autoSync,
  onChange,
}: {
  autoSync: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-accent/20 bg-background/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <Label
            htmlFor="auto-sync"
            className="text-xs"
          >
            Auto Sync
          </Label>
          <p className="text-[11px] text-muted-foreground">
            Periodically sync all registered Knots and Beads
            projects while Foolery is open.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshCw className="size-4 text-feature-500" />
          <Switch
            id="auto-sync"
            checked={autoSync}
            onCheckedChange={onChange}
            aria-label="Auto Sync"
          />
        </div>
      </div>
    </div>
  );
}
