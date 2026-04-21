"use client";

import type {
  EffSpeedLeader,
  RawSpeedLeader,
} from "@/components/lease-audit-speed";

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

function RowBg(i: number): string {
  return i % 2 === 0 ? "bg-background" : "bg-muted/10";
}

const TD_BASE = "px-3 py-1.5";
const TD_NUM = `${TD_BASE} text-right tabular-nums`;
const TD_LEAD = `${TD_BASE} font-medium text-foreground`;
const TD_GREEN = (
  `${TD_NUM} text-moss-600 dark:text-moss-400`
);
const TD_MUTED = `${TD_NUM} text-muted-foreground`;

export function EffSpeedLeaderboardTable(
  { rows }: { rows: EffSpeedLeader[] },
) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">
        Leaderboard &mdash; Effective Speed
      </h3>
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30">
              <TH align="left">Step</TH>
              <TH align="left">Best Agent</TH>
              <TH align="right">Eff. Speed</TH>
              <TH align="right">Raw Speed</TH>
              <TH align="right">Rate</TH>
              <TH align="right">Attempts/Ship</TH>
              <TH align="right">n</TH>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.step} className={RowBg(i)}>
                <td className={TD_LEAD}>
                  {capitalize(r.step)}
                </td>
                <td className={`${TD_BASE} text-foreground`}>
                  {r.bestAgent}
                </td>
                <td className={TD_GREEN}>{r.effSpeed}</td>
                <td className={TD_NUM}>{r.rawSpeed}</td>
                <td className={TD_NUM}>{r.rate}</td>
                <td className={TD_NUM}>
                  {r.attemptsPerShip}
                </td>
                <td className={TD_MUTED}>{r.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RawSpeedLeaderboardTable(
  { rows }: { rows: RawSpeedLeader[] },
) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">
        By Raw Speed
      </h3>
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30">
              <TH align="left">Step</TH>
              <TH align="left">Fastest Agent</TH>
              <TH align="right">Raw Speed</TH>
              <TH align="right">Rate</TH>
              <TH align="right">n</TH>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.step} className={RowBg(i)}>
                <td className={TD_LEAD}>
                  {capitalize(r.step)}
                </td>
                <td className={`${TD_BASE} text-foreground`}>
                  {r.bestAgent}
                </td>
                <td className={TD_GREEN}>{r.rawSpeed}</td>
                <td className={TD_NUM}>{r.rate}</td>
                <td className={TD_MUTED}>{r.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
