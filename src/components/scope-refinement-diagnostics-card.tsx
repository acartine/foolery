"use client";

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

const STALL_THRESHOLD_MS = 180_000;

type WorkerStatus = "Idle" | "Processing" | "Stalled";

function deriveStatus(
  worker: ScopeRefinementWorkerHealth,
): WorkerStatus {
  if (worker.activeJobs.length === 0) return "Idle";
  const hasStalled = worker.activeJobs.some(
    (j) => Date.now() - j.startedAt > STALL_THRESHOLD_MS,
  );
  return hasStalled ? "Stalled" : "Processing";
}

function statusVariant(
  status: WorkerStatus,
): "default" | "secondary" | "destructive" {
  if (status === "Idle") return "secondary";
  if (status === "Processing") return "default";
  return "destructive";
}

function formatAge(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
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

  if (!data?.ok || !data.data) return null;

  const { queueSize, completions, worker } = data.data;
  const status = deriveStatus(worker);

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
        <FailuresTable
          failures={worker.recentFailures}
        />
        <CompletionsTable completions={completions} />
      </CardContent>
    </Card>
  );
}
