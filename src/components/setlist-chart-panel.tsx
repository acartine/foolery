"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { SetlistChartModel } from "@/lib/setlist-chart";
import { buildBeatFocusHref } from "@/lib/beat-navigation";

export function SetlistChartPanel({
  chart,
  repoPath,
}: {
  chart: SetlistChartModel;
  repoPath?: string;
}) {
  const waveGroups = buildWaveGroups(chart);
  const lastRowByWave = buildLastRowByWave(chart);
  const searchParams = useSearchParams();

  return (
    <div className="flex flex-col">
      <div className="overflow-auto">
        <div
          className="grid w-full gap-x-0 gap-y-[4px] pb-[4px]"
          style={{
            gridTemplateColumns: `repeat(${chart.slots.length}, minmax(0, 1fr))`,
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

        {chart.rows.map((row, rowIndex) => (
          <ChartRow
            key={row.beatId}
            row={row}
            rowIndex={rowIndex}
            slots={chart.slots}
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

function buildWaveGroups(chart: SetlistChartModel) {
  return chart.slots.reduce<Array<{
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

function buildLastRowByWave(chart: SetlistChartModel) {
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
  return (
    <div
      className="flex min-w-0 flex-col justify-start rounded-[3px] px-[2px] py-[2px]"
      style={{
        gridColumn: `${columnStart} / span ${cell?.span ?? 1}`,
        ...(waveActive ? waveToneStyle(waveLabel, 0.34) : {}),
      }}
    >
      {cell ? (
        <div className="w-full overflow-hidden rounded-sm border border-zinc-400 bg-transparent">
          <div
            className="overflow-hidden whitespace-nowrap px-[4px] py-[4px]"
            style={waveToneStyle(waveLabel, 0.6)}
          >
            <Link
              href={detailHref ?? "#"}
              className="shrink-0 font-mono text-[11px] font-semibold leading-none text-foreground underline-offset-2 hover:underline"
            >
              {cell.beatLabel}
            </Link>
          </div>
          <div className="w-full border-t border-zinc-300 bg-stone-50/85 px-[4px] py-[3px] whitespace-normal break-words text-[11px] leading-tight text-foreground/80">
            {resolveSetlistTitle(cell)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function resolveSetlistTitle(
  cell: NonNullable<SetlistChartModel["rows"][number]["cells"][number]>,
): string {
  const titleCandidate = sanitizeDisplayText(
    stripLeadingBeatPrefix(cell.title, cell.beatId, cell.beatLabel),
  );
  if (titleCandidate && !looksLikeBeatIdentifier(titleCandidate, cell)) {
    return titleCandidate;
  }

  const notesCandidate = sanitizeDisplayText(cell.notes);
  if (notesCandidate) {
    return notesCandidate;
  }

  return titleCandidate || cell.beatLabel;
}

function stripLeadingBeatPrefix(
  title: string,
  beatId: string,
  beatLabel: string,
): string {
  const escapedBeatId = escapeRegExp(beatId);
  const escapedBeatLabel = escapeRegExp(beatLabel);
  return title
    .replace(new RegExp(`^${escapedBeatId}[\\s:._-]*`, "i"), "")
    .replace(new RegExp(`^${escapedBeatLabel}[\\s:._-]*`, "i"), "");
}

function sanitizeDisplayText(value: string | undefined): string {
  if (!value) {
    return "";
  }
  const trimmed = value.trim();
  const cutoff = findTitleCutoff(trimmed);
  return trimmed.slice(0, cutoff).trim();
}

function looksLikeBeatIdentifier(
  value: string,
  cell: NonNullable<SetlistChartModel["rows"][number]["cells"][number]>,
): boolean {
  const normalized = value.trim().toLowerCase();
  const beatId = cell.beatId.toLowerCase();
  const beatLabel = cell.beatLabel.toLowerCase();

  return normalized.length === 0
    || normalized === beatId
    || normalized === beatLabel
    || normalized === "foolery"
    || normalized.startsWith("foolery ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findTitleCutoff(value: string): number {
  for (let index = 40; index < value.length; index += 1) {
    if (!/[A-Za-z0-9 ]/.test(value[index] ?? "")) {
      return index;
    }
  }
  return value.length;
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
