"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

const MIN_CONCURRENT_SESSIONS = 1;
const MAX_CONCURRENT_SESSIONS = 20;

interface SettingsSessionsSectionProps {
  maxConcurrentSessions: number;
  onMaxConcurrentSessionsChange: (maxConcurrentSessions: number) => void;
}

function clampConcurrentSessions(value: number): number {
  return Math.min(
    MAX_CONCURRENT_SESSIONS,
    Math.max(MIN_CONCURRENT_SESSIONS, value),
  );
}

export function SettingsSessionsSection({
  maxConcurrentSessions,
  onMaxConcurrentSessionsChange,
}: SettingsSessionsSectionProps) {
  return (
    <div className="space-y-2 rounded-xl border border-accent/20 bg-background/60 p-3">
      <Label htmlFor="max-concurrent-sessions" className="text-xs">
        Max Concurrent Sessions
      </Label>
      <Input
        id="max-concurrent-sessions"
        type="number"
        min={MIN_CONCURRENT_SESSIONS}
        max={MAX_CONCURRENT_SESSIONS}
        step={1}
        value={maxConcurrentSessions}
        onChange={(event) => {
          const nextValue = Number.parseInt(event.target.value, 10);
          if (Number.isNaN(nextValue)) return;
          onMaxConcurrentSessionsChange(clampConcurrentSessions(nextValue));
        }}
        className="w-28 border-primary/20 bg-background/80"
      />
      <p className="text-[11px] text-muted-foreground">
        Controls how many take sessions Foolery can run at once before extra
        scene beats are queued. Choose between 1 and 20.
      </p>
    </div>
  );
}
