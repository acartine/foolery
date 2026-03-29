"use client";

import { Profiler, type ReactNode } from "react";
import { createPerfEvent } from "@/lib/perf-events";
import {
  isDiagnosticsEnabled,
  recordClientPerfEvent,
} from "@/lib/client-perf";

interface PerfProfilerProps {
  id: string;
  interactionLabel?: string;
  beatCount?: number;
  children: ReactNode;
}

export function PerfProfiler({
  id,
  interactionLabel,
  beatCount,
  children,
}: PerfProfilerProps) {
  return (
    <Profiler
      id={id}
      onRender={(
        profilerId,
        phase,
        actualDuration,
        baseDuration,
        startTime,
        commitTime,
      ) => {
        if (!isDiagnosticsEnabled()) {
          return;
        }
        const event = createPerfEvent({
          kind: "render_commit",
          profilerId,
          phase,
          actualDurationMs: Number(actualDuration.toFixed(1)),
          baseDurationMs: Number(baseDuration.toFixed(1)),
          startTimeMs: Number(startTime.toFixed(1)),
          commitTimeMs: Number(commitTime.toFixed(1)),
          interactionLabel,
          beatCount,
        });
        recordClientPerfEvent(event, { emit: false });
      }}
    >
      {children}
    </Profiler>
  );
}
