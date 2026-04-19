"use client";

import {
  useMemo,
  useState,
} from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  isTerminalSetlistState,
  paginateSetlistChart,
  type SetlistChartModel,
} from "@/lib/setlist-chart";
import { buildBeatFocusHref } from "@/lib/beat-navigation";
import { Button } from "@/components/ui/button";

export function SetlistChartPanel({
  chart,
  repoPath,
}: {
  chart: SetlistChartModel;
  repoPath?: string;
}) {
  const pagination = useMemo(
    () => paginateSetlistChart(chart),
    [chart],
  );
  const paginationKey = useMemo(
    () => buildPaginationKey(chart, pagination.initialPageIndex),
    [chart, pagination.initialPageIndex],
  );

  return (
    <PaginatedSetlistChart
      key={paginationKey}
      chart={chart}
      pagination={pagination}
      repoPath={repoPath}
    />
  );
}

function PaginatedSetlistChart({
  chart,
  pagination,
  repoPath,
}: {
  chart: SetlistChartModel;
  pagination: ReturnType<typeof paginateSetlistChart>;
  repoPath?: string;
}) {
  const [pageIndex, setPageIndex] = useState(pagination.initialPageIndex);
  const searchParams = useSearchParams();
  const currentPage = pagination.pages[pageIndex] ?? pagination.pages[0];
  const waveGroups = buildWaveGroups(currentPage.slots);
  const lastRowByWave = buildLastRowByWave(currentPage);

  return (
    <div className="flex flex-col gap-2">
      {pagination.pages.length > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            Steps {currentPage.slotStart + 1}-{currentPage.slotEnd}
            {" "}of {chart.slots.length}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPageIndex((value) => Math.max(value - 1, 0))}
              disabled={pageIndex === 0}
            >
              <ChevronLeft className="size-4" />
              Earlier
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setPageIndex((value) =>
                  Math.min(value + 1, pagination.pages.length - 1)
                )}
              disabled={pageIndex >= pagination.pages.length - 1}
            >
              Later
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-auto">
        <div
          className="grid w-full gap-x-0 gap-y-[4px] pb-[4px]"
          style={{
            gridTemplateColumns: `repeat(${currentPage.slots.length}, minmax(0, 1fr))`,
          }}
        >
          {waveGroups.map((wave) => (
            <div
              key={wave.id}
              className="rounded-[3px] px-[4px] py-[4px]"
              style={{
                gridColumn: `span ${wave.span}`,
                ...waveToneStyle(wave.waveLabel, 0.48),
              }}
            >
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {wave.waveLabel}
              </div>
              <div className="text-[11px] font-semibold text-foreground">
                {wave.detail}
              </div>
            </div>
          ))}
        </div>

        {currentPage.rows.map((row, rowIndex) => (
          <ChartRow
            key={row.beatId}
            row={row}
            rowIndex={rowIndex}
            slots={currentPage.slots}
            lastRowByWave={lastRowByWave}
            detailHrefBuilder={(beatId) =>
              buildBeatFocusHref(
                beatId,
                searchParams.toString(),
                { detailRepo: repoPath },
              )}
          />
        ))}
      </div>
    </div>
  );
}

function buildPaginationKey(
  chart: SetlistChartModel,
  initialPageIndex: number,
): string {
  return [
    initialPageIndex,
    chart.slots.map((slot) => slot.id).join(","),
    chart.rows.map((row) => `${row.beatId}:${row.state ?? ""}`).join(","),
  ].join("::");
}

function buildWaveGroups(slots: SetlistChartModel["slots"]) {
  return slots.reduce<Array<{
    id: string;
    waveLabel: string;
    detail: string;
    span: number;
  }>>((groups, slot) => {
    const previous = groups[groups.length - 1];
    if (
      previous &&
      previous.waveLabel === slot.waveLabel &&
      previous.detail === slot.detail
    ) {
      previous.span += 1;
      return groups;
    }

    groups.push({
      id: `${slot.waveLabel}-${groups.length}`,
      waveLabel: slot.waveLabel,
      detail: slot.detail,
      span: 1,
    });
    return groups;
  }, []);
}

function buildLastRowByWave(chart: Pick<SetlistChartModel, "rows" | "slots">) {
  const lastRowByWave = new Map<string, number>();

  chart.rows.forEach((row, rowIndex) => {
    row.cells.forEach((cell, slotIndex) => {
      if (!cell) {
        return;
      }
      const waveLabel = chart.slots[slotIndex]?.waveLabel;
      if (!waveLabel) {
        return;
      }
      lastRowByWave.set(
        waveLabel,
        Math.max(lastRowByWave.get(waveLabel) ?? -1, rowIndex),
      );
    });
  });

  return lastRowByWave;
}

function ChartRow({
  row,
  rowIndex,
  slots,
  lastRowByWave,
  detailHrefBuilder,
}: {
  row: SetlistChartModel["rows"][number];
  rowIndex: number;
  slots: SetlistChartModel["slots"];
  lastRowByWave: ReadonlyMap<string, number>;
  detailHrefBuilder: (beatId: string) => string;
}) {
  return (
    <div
      className="grid gap-x-0"
      style={{
        gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))`,
      }}
    >
      {slots.map((slot, slotIndex) => (
        <ChartCell
          key={`${row.beatId}-${slot.id}`}
          cell={row.cells[slotIndex] ?? null}
          columnStart={slotIndex + 1}
          waveActive={rowIndex <= (lastRowByWave.get(slot.waveLabel) ?? -1)}
          waveLabel={slot.waveLabel}
          detailHref={
            row.cells[slotIndex]
              ? detailHrefBuilder(row.cells[slotIndex]!.detailBeatId)
              : null
          }
        />
      ))}
    </div>
  );
}

function ChartCell({
  cell,
  columnStart,
  waveActive,
  waveLabel,
  detailHref,
}: {
  cell: SetlistChartModel["rows"][number]["cells"][number];
  columnStart: number;
  waveActive: boolean;
  waveLabel: string;
  detailHref: string | null;
}) {
  const isTerminal = isTerminalSetlistState(cell?.state);
  const isCompleted = cell?.state === "shipped";

  return (
    <div
      className="flex min-w-0 flex-col justify-start rounded-[3px] px-[2px] py-[2px]"
      style={{
        gridColumn: `${columnStart} / span ${cell?.span ?? 1}`,
        ...(waveActive ? waveToneStyle(waveLabel, 0.34) : {}),
      }}
    >
      {cell ? (
        <div
          className={
            "w-full overflow-hidden rounded-sm border bg-transparent"
            + (isTerminal
              ? " border-zinc-300/90 opacity-85"
              : " border-zinc-400")
          }
        >
          <div
            className="flex items-center justify-between gap-2 overflow-hidden whitespace-nowrap px-[4px] py-[2px]"
            style={waveToneStyle(waveLabel, 0.6)}
          >
            <Link
              href={detailHref ?? "#"}
              className={
                "shrink-0 font-mono text-[11px] leading-none underline-offset-2"
                + (isTerminal
                  ? " text-foreground/55 line-through italic hover:text-foreground/70 hover:underline"
                  : " font-semibold text-foreground hover:underline")
              }
            >
              {cell.beatLabel}
            </Link>
            {isCompleted ? (
              <span
                className="inline-flex size-[14px] shrink-0 items-center justify-center rounded-full bg-emerald-100/80 text-emerald-700"
                title="Completed knot"
              >
                <CheckCircle2 className="size-[10px]" />
              </span>
            ) : null}
          </div>
          {cell.title !== cell.beatLabel ? (
            <div
              className={
                "w-full border-t px-[4px] py-[2px] whitespace-normal break-words text-[11px] leading-tight"
                + (isTerminal
                  ? " border-zinc-200 bg-stone-50/55 text-foreground/55 italic"
                  : " border-zinc-300 bg-stone-50/85 text-foreground/80")
              }
            >
              {cell.title}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function waveToneStyle(
  waveLabel: string,
  alpha: number,
): { backgroundColor: string } {
  const waveIndex = Number.parseInt(
    waveLabel.replace(/[^0-9]/g, ""),
    10,
  );

  switch (waveIndex) {
    case 1:
      return { backgroundColor: `rgba(236, 212, 255, ${alpha})` };
    case 2:
      return { backgroundColor: `rgba(206, 235, 255, ${alpha})` };
    case 3:
      return { backgroundColor: `rgba(212, 243, 225, ${alpha})` };
    default:
      return { backgroundColor: `rgba(240, 235, 255, ${alpha})` };
  }
}
