"use client";

import type { ReactNode } from "react";
import { BeatPriorityBadge } from "@/components/beat-priority-badge";
import { BeatTypeBadge } from "@/components/beat-type-badge";
import { Badge } from "@/components/ui/badge";
import type { SetlistChartModel } from "@/lib/setlist-chart";
import type { Beat } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SetlistChartPanel({
  chart,
  beats,
}: {
  chart: SetlistChartModel;
  beats: Beat[];
}) {
  return (
    <div className="flex h-full flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Y-axis is execution priority from{" "}
          <span className="font-medium text-foreground">
            Next
          </span>{" "}
          to{" "}
          <span className="font-medium text-foreground">
            Last
          </span>
          . X-axis uses equal-width execution slots, not time estimates.
        </p>
        <Badge variant="secondary" className="h-7 px-3 text-xs">
          {beats.length} repo beats indexed
        </Badge>
      </div>

      <div className="flex-1 overflow-auto rounded-xl border border-border/60">
        <div
          className="grid min-w-[60rem] border-b border-border/60 bg-muted/20"
          style={{
            gridTemplateColumns: `10rem repeat(${chart.slots.length}, minmax(10rem, 1fr))`,
          }}
        >
          <AxisCell className="border-r border-border/60 font-semibold">
            Priority
          </AxisCell>
          {chart.slots.map((slot) => (
            <AxisCell key={slot.id}>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {slot.waveLabel}
              </div>
              <div className="text-sm font-semibold">
                {slot.label}
              </div>
              <div className="text-xs text-muted-foreground">
                {slot.detail}
              </div>
            </AxisCell>
          ))}
        </div>

        {chart.lanes.map((lane) => (
          <ChartLaneRow
            key={lane.priority}
            lane={lane}
            slotCount={chart.slots.length}
            slotIds={chart.slots.map((slot) => slot.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ChartLaneRow({
  lane,
  slotCount,
  slotIds,
}: {
  lane: SetlistChartModel["lanes"][number];
  slotCount: number;
  slotIds: string[];
}) {
  return (
    <div
      className="grid border-b border-border/60 last:border-b-0"
      style={{
        gridTemplateColumns: `10rem repeat(${slotCount}, minmax(10rem, 1fr))`,
      }}
    >
      <div
        className={
          "flex min-h-32 flex-col justify-center border-r"
          + " border-border/60 bg-muted/10 px-4 py-3"
        }
      >
        <div className="flex items-center gap-2">
          <BeatPriorityBadge priority={lane.priority} />
          <span className="text-sm font-semibold">
            {lane.label}
          </span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {lane.itemsCount} task{lane.itemsCount === 1 ? "" : "s"}
        </div>
      </div>

      {lane.cells.map((cell, slotIndex) => (
        <ChartLaneCell
          key={`${lane.priority}-${slotIds[slotIndex]}`}
          cell={cell}
        />
      ))}
    </div>
  );
}

function ChartLaneCell({
  cell,
}: {
  cell: SetlistChartModel["lanes"][number]["cells"][number];
}) {
  return (
    <div
      className={
        "flex min-h-32 flex-col gap-2 border-r"
        + " border-border/50 px-3 py-3 last:border-r-0"
      }
    >
      {cell.map((item) => (
        <div
          key={item.beatId}
          className="rounded-xl border border-border/70 bg-background px-3 py-2 shadow-sm"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">
              {item.beatLabel}
            </span>
            {item.type && <BeatTypeBadge type={item.type} />}
            {item.state && (
              <Badge variant="outline" className="text-[10px]">
                {item.state}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm font-semibold leading-tight">
            {item.title}
          </p>
          <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
            {item.description ?? "No description yet."}
          </p>
        </div>
      ))}
    </div>
  );
}

function AxisCell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-4 py-3", className)}>
      {children}
    </div>
  );
}
