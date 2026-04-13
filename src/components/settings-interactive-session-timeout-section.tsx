"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MAX_INTERACTIVE_SESSION_TIMEOUT_MINUTES,
  MIN_INTERACTIVE_SESSION_TIMEOUT_MINUTES,
} from "@/lib/interactive-session-timeout";
import type { DefaultsSettings } from "@/lib/schemas";

interface InteractiveSessionTimeoutSectionProps {
  defaults: DefaultsSettings;
  onDefaultsChange: (defaults: DefaultsSettings) => void;
}

export function InteractiveSessionTimeoutSection({
  defaults,
  onDefaultsChange,
}: InteractiveSessionTimeoutSectionProps) {
  return (
    <div className="space-y-2 rounded-xl border border-accent/20 bg-background/60 p-3">
      <Label
        htmlFor="interactive-session-timeout-minutes"
        className="text-xs"
      >
        Interactive Session Timeout
      </Label>
      <Input
        id="interactive-session-timeout-minutes"
        type="number"
        min={MIN_INTERACTIVE_SESSION_TIMEOUT_MINUTES}
        max={MAX_INTERACTIVE_SESSION_TIMEOUT_MINUTES}
        value={defaults.interactiveSessionTimeoutMinutes}
        onChange={(event) => {
          const value = parseInt(event.target.value, 10);
          if (
            Number.isNaN(value) ||
            value < MIN_INTERACTIVE_SESSION_TIMEOUT_MINUTES ||
            value > MAX_INTERACTIVE_SESSION_TIMEOUT_MINUTES
          ) {
            return;
          }
          onDefaultsChange({
            ...defaults,
            interactiveSessionTimeoutMinutes: value,
          });
        }}
        className="w-28 border-primary/20 bg-background/80"
      />
      <p className="text-[11px] text-muted-foreground">
        Inactivity timeout for interactive agent
        sessions, in minutes.
      </p>
    </div>
  );
}
