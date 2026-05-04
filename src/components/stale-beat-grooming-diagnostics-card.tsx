"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchStaleBeatGroomingStatus } from "@/lib/stale-beat-grooming-api";
import { Badge } from "@/components/ui/badge";
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
import type {
  StaleBeatGroomingActiveJob,
  StaleBeatGroomingCompletion,
  StaleBeatGroomingFailure,
  StaleBeatGroomingWorkerHealth,
} from "@/lib/stale-beat-grooming-types";

type WorkerStatus = "Idle" | "Processing" | "Slow";

const SLOW_THRESHOLD_MS = 120_000;

export function StaleBeatGroomingDiagnosticsCard() {
  const { data } = useQuery({
    queryKey: ["stale-beat-grooming-status"],
    queryFn: fetchStaleBeatGroomingStatus,
    refetchInterval: 5_000,
  });
  const now = useNow();

  if (!data?.ok || !data.data) return null;

  const { queueSize, worker } = data.data;
  const status = deriveStatus(worker, now);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stale Grooming Worker</CardTitle>
        <CardDescription>
          Queue and review status for stale beat grooming.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3">
          <Badge variant={status === "Idle" ? "secondary" : "default"}>
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
        <ActiveJobsTable jobs={worker.activeJobs} now={now} />
        <FailuresTable failures={worker.recentFailures} />
        <CompletionsTable completions={worker.recentCompletions} />
      </CardContent>
    </Card>
  );
}

function deriveStatus(
  worker: StaleBeatGroomingWorkerHealth,
  now: number,
): WorkerStatus {
  if (worker.activeJobs.length === 0) return "Idle";
  const maxAge = Math.max(
    ...worker.activeJobs.map((job) => now - job.startedAt),
  );
  return maxAge > SLOW_THRESHOLD_MS ? "Slow" : "Processing";
}

function ActiveJobsTable({
  jobs,
  now,
}: {
  jobs: StaleBeatGroomingActiveJob[];
  now: number;
}) {
  if (jobs.length === 0) return null;
  return (
    <DiagnosticsTable title="Active Jobs" headers={["Beat", "Age", "Agent"]}>
      {jobs.map((job) => (
        <TableRow key={job.jobId}>
          <TableCell className="font-mono text-xs">{job.beatId}</TableCell>
          <TableCell className="text-xs">
            {formatAge(now - job.startedAt)}
          </TableCell>
          <TableCell className="font-mono text-xs">{job.agentId}</TableCell>
        </TableRow>
      ))}
    </DiagnosticsTable>
  );
}

function FailuresTable({
  failures,
}: {
  failures: StaleBeatGroomingFailure[];
}) {
  if (failures.length === 0) return null;
  return (
    <DiagnosticsTable
      title="Recent Failures"
      headers={["Beat", "Reason", "When"]}
    >
      {failures.slice(0, 5).map((failure) => (
        <TableRow key={`${failure.jobId}-${failure.timestamp}`}>
          <TableCell className="font-mono text-xs">
            {failure.beatId}
          </TableCell>
          <TableCell className="max-w-[300px] truncate text-xs">
            {failure.reason}
          </TableCell>
          <TableCell className="text-xs">
            {new Date(failure.timestamp).toLocaleTimeString()}
          </TableCell>
        </TableRow>
      ))}
    </DiagnosticsTable>
  );
}

function CompletionsTable({
  completions,
}: {
  completions: StaleBeatGroomingCompletion[];
}) {
  if (completions.length === 0) return null;
  return (
    <DiagnosticsTable
      title="Recent Completions"
      headers={["Beat", "Decision", "When"]}
    >
      {completions.slice(0, 5).map((completion) => (
        <TableRow key={`${completion.jobId}-${completion.timestamp}`}>
          <TableCell className="font-mono text-xs">
            {completion.beatId}
          </TableCell>
          <TableCell className="text-xs">
            {completion.decision ?? "completed"}
          </TableCell>
          <TableCell className="text-xs">
            {new Date(completion.timestamp).toLocaleTimeString()}
          </TableCell>
        </TableRow>
      ))}
    </DiagnosticsTable>
  );
}

function DiagnosticsTable({
  title,
  headers,
  children,
}: {
  title: string;
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className="mt-4">
      <h4 className="mb-2 text-sm font-medium">{title}</h4>
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header}>{header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
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

function formatAge(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}
