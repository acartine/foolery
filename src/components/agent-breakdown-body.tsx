"use client";

import type { AgentStepRow, DurationStats } from "@/components/lease-audit-helpers";
import type { SpeedRow } from "@/components/lease-audit-speed";
import { formatDuration } from "@/components/lease-audit-speed";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function TH({
  align,
  children,
}: {
  align: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <th
      className={
        "px-3 py-2 font-medium text-muted-foreground "
        + `text-${align}`
      }
    >
      {children}
    </th>
  );
}

function lookupStepDuration(
  agent: string,
  step: string,
  durationMap: Map<string, DurationStats>,
): DurationStats | undefined {
  return durationMap.get(`${agent}::${step}`);
}

function lookupEffSpeed(
  agent: string,
  step: string,
  speedRows: SpeedRow[],
): SpeedRow | undefined {
  return speedRows.find(
    (r) => r.agent === agent && r.step === step,
  );
}

export function AgentBreakdownBody({
  rows,
  agent,
  durationMap,
  speedRows,
}: {
  rows: AgentStepRow[];
  agent: string;
  durationMap: Map<string, DurationStats>;
  speedRows: SpeedRow[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/60 bg-muted/30">
            <TH align="left">Step</TH>
            <TH align="right">Rate</TH>
            <TH align="right">n</TH>
            <TH align="right">Mean</TH>
            <TH align="right">vs Mean</TH>
            <TH align="right">Median</TH>
            <TH align="right">Eff. Speed</TH>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const dur = lookupStepDuration(
              agent, row.step, durationMap,
            );
            const spd = lookupEffSpeed(
              agent, row.step, speedRows,
            );
            return (
              <AgentBreakdownRow
                key={row.step}
                row={row}
                even={i % 2 === 0}
                medianMs={dur?.median}
                effSpeedMs={spd?.effectiveSpeed}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AgentBreakdownRow({
  row,
  even,
  medianMs,
  effSpeedMs,
}: {
  row: AgentStepRow;
  even: boolean;
  medianMs: number | undefined;
  effSpeedMs: number | null | undefined;
}) {
  return (
    <tr className={even ? "bg-background" : "bg-muted/10"}>
      <td className="px-3 py-1.5 font-medium text-foreground">
        {capitalize(row.step)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums text-foreground">
        {row.rate}%
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
        {row.n}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
        {row.meanRate}%
      </td>
      <td
        className={`px-3 py-1.5 text-right tabular-nums ${
          row.rate >= row.meanRate
            ? "text-green-600 dark:text-green-400"
            : "text-red-600 dark:text-red-400"
        }`}
      >
        {row.offset}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
        {medianMs != null ? formatDuration(medianMs) : "-"}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
        {effSpeedMs != null
          ? formatDuration(effSpeedMs)
          : "-"}
      </td>
    </tr>
  );
}
