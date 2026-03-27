"use client";

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

function meanEffectiveSpeed(rows: SpeedRow[]): Map<string, number> {
  const byStep = new Map<string, number[]>();
  for (const r of rows) {
    if (r.effectiveSpeed == null) continue;
    const arr = byStep.get(r.step) ?? [];
    arr.push(r.effectiveSpeed);
    byStep.set(r.step, arr);
  }
  const result = new Map<string, number>();
  for (const [step, vals] of byStep) {
    result.set(
      step,
      vals.reduce((a, b) => a + b, 0) / vals.length,
    );
  }
  return result;
}

function speedColor(
  effSpeed: number | null,
  stepMean: number | undefined,
): string {
  if (effSpeed == null || stepMean == null) return "";
  return effSpeed <= stepMean
    ? "text-green-600 dark:text-green-400"
    : "text-red-600 dark:text-red-400";
}

function formatN(n: number, totalN: number): string {
  return n === totalN ? `${n}` : `${n}/${totalN}`;
}

export function SpeedTable({
  speedRows,
}: {
  speedRows: SpeedRow[];
}) {
  if (speedRows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Duration data collecting...
      </p>
    );
  }

  const stepMeans = meanEffectiveSpeed(speedRows);

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">
        Speed &amp; Cost-Adjusted Throughput
      </h3>
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30">
              <TH align="left">Agent</TH>
              <TH align="left">Step</TH>
              <TH align="right">Raw Speed</TH>
              <TH align="right">Rate</TH>
              <TH align="right">Attempts/Ship</TH>
              <TH align="right">Eff. Speed</TH>
              <TH align="right">n</TH>
            </tr>
          </thead>
          <tbody>
            {speedRows.map((row, i) => (
              <SpeedRow
                key={`${row.agent}::${row.step}`}
                row={row}
                even={i % 2 === 0}
                stepMean={stepMeans.get(row.step)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SpeedRow({
  row,
  even,
  stepMean,
}: {
  row: SpeedRow;
  even: boolean;
  stepMean: number | undefined;
}) {
  const effColor = speedColor(
    row.effectiveSpeed, stepMean,
  );
  return (
    <tr className={even ? "bg-background" : "bg-muted/10"}>
      <td className="px-3 py-1.5 font-medium text-foreground">
        {row.agent}
      </td>
      <td className="px-3 py-1.5 text-foreground">
        {capitalize(row.step)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">
        {formatDuration(row.rawMedian)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">
        {row.successRate}%
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">
        {row.attemptsPerShip}
      </td>
      <td
        className={
          "px-3 py-1.5 text-right tabular-nums "
          + effColor
        }
      >
        {row.effectiveSpeed != null
          ? formatDuration(row.effectiveSpeed)
          : "-"}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
        {formatN(row.n, row.totalN)}
      </td>
    </tr>
  );
}
