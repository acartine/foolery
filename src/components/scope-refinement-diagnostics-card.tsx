"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchScopeRefinementStatus } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type {
  ScopeRefinementFailure,
  ScopeRefinementWorkerHealth,
  ScopeRefinementCompletion,
} from "@/lib/types";

// Subprocess timeout is 600s (PROMPT_TIMEOUT_MS). A healthy
// worker must have released its activeJob slot before then —
// either via success, failure, or SIGKILL. Anything past the
// timeout is a real bug, not slowness, so flag it as Stalled.
// Slow flags long-running but plausibly-still-working jobs.
const SLOW_THRESHOLD_MS = 120_000;
const STALL_THRESHOLD_MS = 660_000;

type WorkerStatus =
  | "Idle"
  | "Processing"
  | "Slow"
  | "Stalled";

function deriveStatus(
  worker: ScopeRefinementWorkerHealth,
  now: number,
): WorkerStatus {
  if (worker.activeJobs.length === 0) return "Idle";
  const ages = worker.activeJobs.map(
    (j) => now - j.startedAt,
  );
  const max = Math.max(...ages);
  if (max > STALL_THRESHOLD_MS) return "Stalled";
  if (max > SLOW_THRESHOLD_MS) return "Slow";
  return "Processing";
}

function statusVariant(
  status: WorkerStatus,
): "default" | "secondary" | "destructive" {
  if (status === "Idle") return "secondary";
  if (status === "Stalled") return "destructive";
  return "default";
}

function formatAge(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = window.setInterval(
      () => setNow(Date.now()),
      intervalMs,
    );
    return () => window.clearInterval(handle);
  }, [intervalMs]);
  return now;
}

function ActiveJobsTable({
  jobs,
  now,
}: {
  jobs: ScopeRefinementWorkerHealth["activeJobs"];
  now: number;
}) {
  if (jobs.length === 0) return null;
  return (
    <div className="mt-4">
      <h4 className="mb-2 text-sm font-medium">
        Active Jobs
      </h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Beat</TableHead>
            <TableHead>Age</TableHead>
            <TableHead>Started</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((j) => {
            const age = now - j.startedAt;
            const isSlow = age > SLOW_THRESHOLD_MS;
            const isStalled = age > STALL_THRESHOLD_MS;
            return (
              <TableRow key={`${j.beatId}-${j.startedAt}`}>
                <TableCell className="font-mono text-xs">
                  {j.beatId}
                </TableCell>
                <TableCell
                  className={
                    "text-xs "
                    + (isStalled
                      ? "text-destructive font-medium"
                      : isSlow
                        ? "text-amber-600 font-medium"
                        : "")
                  }
                >
                  {formatAge(age)}
                </TableCell>
                <TableCell className="text-xs">
                  {new Date(
                    j.startedAt,
                  ).toLocaleTimeString()}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function FailuresTable({
  failures,
}: {
  failures: ScopeRefinementFailure[];
}) {
  if (failures.length === 0) return null;
  return (
    <div className="mt-4">
      <h4 className="mb-2 text-sm font-medium">
        Recent Failures
      </h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Beat</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {failures.slice(0, 5).map((f, i) => (
            <TableRow key={`${f.beatId}-${i}`}>
              <TableCell className="font-mono text-xs">
                {f.beatId}
              </TableCell>
              <TableCell className="max-w-[300px] truncate text-xs text-muted-foreground">
                {f.reason}
              </TableCell>
              <TableCell className="text-xs">
                {new Date(
                  f.timestamp,
                ).toLocaleTimeString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CompletionsTable({
  completions,
}: {
  completions: ScopeRefinementCompletion[];
}) {
  if (completions.length === 0) return null;
  return (
    <div className="mt-4">
      <h4 className="mb-2 text-sm font-medium">
        Recent Completions
      </h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Beat</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {completions.slice(0, 5).map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-mono text-xs">
                {c.beatId}
              </TableCell>
              <TableCell className="max-w-[300px] truncate text-xs">
                {c.beatTitle}
              </TableCell>
              <TableCell className="text-xs">
                {new Date(
                  c.timestamp,
                ).toLocaleTimeString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ScopeRefinementDiagnosticsCard() {
  const { data } = useQuery({
    queryKey: ["scope-refinement-status"],
    queryFn: fetchScopeRefinementStatus,
    refetchInterval: 5_000,
  });
  const now = useNow();

  if (!data?.ok || !data.data) return null;

  const { queueSize, completions, worker } = data.data;
  const status = deriveStatus(worker, now);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scope Refinement Worker</CardTitle>
        <CardDescription>
          Event-driven worker health and job status.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3">
          <Badge variant={statusVariant(status)}>
            {status}
          </Badge>
          <span className="text-sm text-muted-foreground">
            Workers: {worker.workerCount}
          </span>
          <span className="text-sm text-muted-foreground">
            Queue: {queueSize}
          </span>
          <span className="text-sm text-muted-foreground">
            Completed: {worker.totalCompleted}
          </span>
          <span className="text-sm text-muted-foreground">
            Failed: {worker.totalFailed}
          </span>
          {worker.uptimeMs != null && (
            <span className="text-sm text-muted-foreground">
              Uptime: {formatAge(worker.uptimeMs)}
            </span>
          )}
        </div>
        <ActiveJobsTable
          jobs={worker.activeJobs}
          now={now}
        />
        <FailuresTable
          failures={worker.recentFailures}
        />
        <CompletionsTable completions={completions} />
      </CardContent>
    </Card>
  );
}
