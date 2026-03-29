"use client";

import { useEffect, useState } from "react";
import { Activity, Gauge, HardDriveDownload, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  getDiagnosticsSnapshot,
  setDiagnosticsEnabled,
} from "@/lib/client-perf";
import type { ClientPerfEvent } from "@/lib/perf-events";

export function RuntimeDiagnosticsPanel() {
  const [snapshot, setSnapshot] = useState(() => getDiagnosticsSnapshot());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setSnapshot(getDiagnosticsSnapshot());
    }, 1_000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  if (!snapshot.enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Runtime Diagnostics</CardTitle>
          <CardDescription>
            Enable local runtime sampling to collect heap churn, long tasks,
            render commits, and query or API timings in this session.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => setDiagnosticsEnabled(true)}>
            Enable runtime diagnostics
          </Button>
        </CardContent>
      </Card>
    );
  }

  const summaryCards = [
    {
      label: "Events",
      value: String(snapshot.summary.totalEvents),
      icon: Activity,
    },
    {
      label: "Long task ms",
      value: formatMs(snapshot.summary.totalLongTaskMs),
      icon: Timer,
    },
    {
      label: "Render ms",
      value: formatMs(snapshot.summary.totalRenderCommitMs),
      icon: Gauge,
    },
    {
      label: "Heap",
      value: snapshot.summary.latestHeapSample
        ? formatBytes(snapshot.summary.latestHeapSample.usedJSHeapSize)
        : snapshot.capabilities.coarseHeap
          ? "Waiting"
          : "Unavailable",
      icon: HardDriveDownload,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((item) => (
          <Card key={item.label} className="gap-3">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-0">
              <CardTitle className="text-sm">{item.label}</CardTitle>
              <item.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl font-semibold tracking-tight">
                {item.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Runtime Events</CardTitle>
          <CardDescription>
            Latest diagnostics events stored in memory and flushed to the local
            diagnostics endpoint for later regression comparison.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RecentEventsTable events={snapshot.recentEvents} />
        </CardContent>
      </Card>
    </div>
  );
}

function RecentEventsTable({ events }: { events: ClientPerfEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        Waiting for runtime events...
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>Details</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.slice(0, 15).map((event) => (
          <TableRow key={event.id}>
            <TableCell className="font-mono text-xs">
              {new Date(event.ts).toLocaleTimeString()}
            </TableCell>
            <TableCell>{event.kind}</TableCell>
            <TableCell className="whitespace-normal text-xs text-muted-foreground">
              {describeEvent(event)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function describeEvent(event: ClientPerfEvent): string {
  if (event.kind === "heap_sample") {
    return `used ${formatBytes(event.usedJSHeapSize)}`;
  }
  if (event.kind === "long_task") {
    return `${formatMs(event.durationMs)} on main thread`;
  }
  if (event.kind === "render_commit") {
    return `${event.profilerId} ${event.phase} ${formatMs(event.actualDurationMs)}`;
  }
  if (event.kind === "query_timing" || event.kind === "api_timing") {
    return `${event.label} ${formatMs(event.durationMs)} ${event.ok ? "ok" : "error"}`;
  }
  if (event.kind === "view_transition") {
    return `${event.pathname}${event.search}`;
  }
  return `heap drop ${formatBytes(event.dropBytes)} (${Math.round(event.dropRatio * 100)}%)`;
}

function formatMs(value: number): string {
  return `${value.toFixed(1)} ms`;
}

function formatBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let unitIndex = 0;
  let current = value;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
