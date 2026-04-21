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
  buildSetlistChartViewport,
  sliceSetlistChart,
  isTerminalSetlistState,
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
  const viewport = useMemo(
    () => buildSetlistChartViewport(chart),
    [chart],
  );
  const viewportKey = useMemo(
    () => buildViewportKey(chart, viewport.initialSlotStart),
    [chart, viewport.initialSlotStart],
  );

  return (
    <SetlistChartViewportPanel
      key={viewportKey}
      chart={chart}
      viewport={viewport}
      repoPath={repoPath}
    />
  );
}

function SetlistChartViewportPanel({
  chart,
  viewport,
  repoPath,
}: {
  chart: SetlistChartModel;
  viewport: ReturnType<typeof buildSetlistChartViewport>;
  repoPath?: string;
}) {
  const [slotStart, setSlotStart] = useState(viewport.initialSlotStart);
  const searchParams = useSearchParams();
  const currentWindow = useMemo(
    () => sliceSetlistChart(chart, slotStart, viewport.pageSize),
    [chart, slotStart, viewport.pageSize],
  );
  const waveGroups = buildWaveGroups(currentWindow.slots);
  const lastRowByWave = buildLastRowByWave(currentWindow);
  const canGoEarlier = currentWindow.slotStart > 0;
  const canGoLater =
    currentWindow.slotStart < viewport.maxSlotStart;

  return (
    <div className="flex flex-col gap-2">
      {viewport.maxSlotStart > 0 ? (
        <SetlistChartWindowNav
          slotStart={currentWindow.slotStart}
          slotEnd={currentWindow.slotEnd}
          slotCount={chart.slots.length}
          canGoEarlier={canGoEarlier}
          canGoLater={canGoLater}
          onEarlier={() =>
            setSlotStart((value) =>
              Math.max(value - viewport.pageSize, 0)
            )}
          onLater={() =>
            setSlotStart((value) =>
              Math.min(
                value + viewport.pageSize,
                viewport.maxSlotStart,
              )
            )}
        />
      ) : null}

      <div className="overflow-auto">
        <div
          className="grid w-full gap-x-0 gap-y-[4px] pb-[4px]"
          style={{
            gridTemplateColumns: `repeat(${currentWindow.slots.length}, minmax(0, 1fr))`,
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

        {currentWindow.rows.map((row, rowIndex) => (
          <ChartRow
            key={row.beatId}
            row={row}
            rowIndex={rowIndex}
            slots={currentWindow.slots}
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

function SetlistChartWindowNav({
  slotStart,
  slotEnd,
  slotCount,
  canGoEarlier,
  canGoLater,
  onEarlier,
  onLater,
}: {
  slotStart: number;
  slotEnd: number;
  slotCount: number;
  canGoEarlier: boolean;
  canGoLater: boolean;
  onEarlier: () => void;
  onLater: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="text-xs text-muted-foreground">
        Steps {slotStart + 1}-{slotEnd} of {slotCount}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onEarlier}
          disabled={!canGoEarlier}
        >
          <ChevronLeft className="size-4" />
          Earlier
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onLater}
          disabled={!canGoLater}
        >
          Later
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function buildViewportKey(
  chart: SetlistChartModel,
  initialSlotStart: number,
): string {
  return [
    initialSlotStart,
    chart.slots.map((slot) => slot.id).join(","),
    chart.rows
      .map((row) =>
        [
          row.beatId,
          row.state ?? "",
          row.cells.map((cell) => cell?.isActiveLease ? "1" : "0").join(""),
        ].join(":")
      )
      .join(","),
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
  const isActiveLease = Boolean(cell?.isActiveLease);

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
          className={buildChartCellClass(
            isActiveLease,
            isTerminal,
          )}
        >
          {isActiveLease ? <ActiveLeaseScan /> : null}
          <div
            className="flex items-center justify-between gap-2 overflow-hidden whitespace-nowrap px-[4px] py-[2px]"
            style={waveToneStyle(
              waveLabel,
              isActiveLease ? 0.72 : 0.6,
            )}
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
            <ChartCellStatusIndicator
              isActiveLease={isActiveLease}
              isCompleted={isCompleted}
            />
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

function buildChartCellClass(
  isActiveLease: boolean,
  isTerminal: boolean,
): string {
  return (
    "relative w-full overflow-hidden rounded-sm border bg-transparent"
    + " transition-[border-color,box-shadow,opacity]"
    + " duration-200"
    + (isActiveLease
      ? " border-paper-500/85 shadow-[0_0_0_1px_rgba(51,65,85,0.18),0_4px_14px_rgba(51,65,85,0.14)]"
      : isTerminal
      ? " border-zinc-300/90 opacity-85"
      : " border-zinc-400")
  );
}

function ActiveLeaseScan() {
  return (
    <div className="pointer-events-none absolute inset-x-1 top-0 h-[2px] overflow-hidden rounded-full opacity-85">
      <span
        className={
          "block h-full w-10 rounded-full"
          + " bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.92),transparent)]"
          + " motion-safe:animate-[setlist-active-scan_2.2s_ease-in-out_infinite]"
        }
      />
    </div>
  );
}

function ChartCellStatusIndicator({
  isActiveLease,
  isCompleted,
}: {
  isActiveLease: boolean;
  isCompleted: boolean;
}) {
  if (isActiveLease) {
    return (
      <span
        className={
          "inline-flex size-[14px] shrink-0 items-center justify-center"
          + " rounded-full border border-paper-500/50"
          + " bg-walnut-400/8"
        }
        title="Active knot lease"
      >
        <span
          className={
            "size-[5px] rounded-full bg-lake-500"
            + " shadow-[0_0_10px_rgba(14,165,233,0.6)]"
            + " motion-safe:animate-pulse"
          }
        />
      </span>
    );
  }

  if (!isCompleted) {
    return null;
  }

  return (
    <span
      className="inline-flex size-[14px] shrink-0 items-center justify-center rounded-full bg-moss-100/80 text-moss-700"
      title="Completed knot"
    >
      <CheckCircle2 className="size-[10px]" />
    </span>
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
