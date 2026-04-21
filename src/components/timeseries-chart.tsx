"use client";

// ── Chart color palette ──

// Per MIGRATION.md §3.3, extended beyond the shadcn 5-slot palette with
// softer supporting tints so series 6-8 stay in the clay/moss/lake families.
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--color-clay-300)",
  "var(--color-moss-400)",
  "var(--color-lake-400)",
];

function colorForIndex(i: number): string {
  return CHART_COLORS[i % CHART_COLORS.length]!;
}

// ── Types ──

export interface TimeseriesPoint {
  date: string;
  value: number | null;
}

export interface AgentSeries {
  agent: string;
  points: TimeseriesPoint[];
  n?: number;
}

// ── Chart constants ──

const CHART_HEIGHT = 120;
const CHART_PADDING_TOP = 8;
const CHART_PADDING_BOTTOM = 20;
const CHART_PADDING_LEFT = 32;
const CHART_PADDING_RIGHT = 8;

// ── Component ──

export function TimeseriesChart({
  title,
  seriesList,
}: {
  title: string;
  seriesList: AgentSeries[];
}) {
  if (seriesList.length === 0) {
    return (
      <EmptyChart title={title} />
    );
  }

  const dateLabels =
    seriesList[0]!.points.map((p) => p.date);
  const numPoints = dateLabels.length;
  const maxValue = 100;
  const drawWidth = Math.max(200, numPoints * 40);
  const totalWidth =
    CHART_PADDING_LEFT +
    drawWidth +
    CHART_PADDING_RIGHT;
  const needsScroll = numPoints > 14;
  const drawHeight =
    CHART_HEIGHT -
    CHART_PADDING_TOP -
    CHART_PADDING_BOTTOM;

  function xPos(i: number): number {
    if (numPoints <= 1)
      return CHART_PADDING_LEFT + drawWidth / 2;
    return (
      CHART_PADDING_LEFT +
      (i / (numPoints - 1)) * drawWidth
    );
  }

  function yPos(value: number): number {
    return (
      CHART_PADDING_TOP +
      drawHeight -
      (value / maxValue) * drawHeight
    );
  }

  const yTicks = [0, 50, 100];

  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-muted/10 p-3">
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">
        {title}
      </h3>
      <div className="overflow-x-auto">
        <svg
          {...(needsScroll
            ? { width: totalWidth }
            : {
                viewBox: `0 0 ${totalWidth} ${CHART_HEIGHT}`,
                className: "block w-full",
                preserveAspectRatio: "xMidYMid meet",
              })}
          height={CHART_HEIGHT}
          role="img"
          aria-label={`${title} chart`}
        >
          <ChartGridLines
            yTicks={yTicks}
            yPos={yPos}
            totalWidth={totalWidth}
          />
          <ChartDateLabels
            dateLabels={dateLabels}
            numPoints={numPoints}
            xPos={xPos}
          />
          <ChartSeriesLines
            seriesList={seriesList}
            xPos={xPos}
            yPos={yPos}
          />
        </svg>
      </div>
      <ChartLegend seriesList={seriesList} />
    </div>
  );
}

function EmptyChart({
  title,
}: {
  title: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-muted/10 p-3">
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">
        {title}
      </h3>
      <p className="py-4 text-center text-xs text-muted-foreground">
        No data
      </p>
    </div>
  );
}

function ChartGridLines({
  yTicks,
  yPos,
  totalWidth,
}: {
  yTicks: number[];
  yPos: (v: number) => number;
  totalWidth: number;
}) {
  return (
    <>
      {yTicks.map((tick) => (
        <g key={`ytick-${tick}`}>
          <line
            x1={CHART_PADDING_LEFT}
            y1={yPos(tick)}
            x2={totalWidth - CHART_PADDING_RIGHT}
            y2={yPos(tick)}
            stroke="currentColor"
            strokeOpacity={0.1}
          />
          <text
            x={CHART_PADDING_LEFT - 4}
            y={yPos(tick) + 3}
            textAnchor="end"
            className="fill-muted-foreground"
            fontSize={9}
          >
            {tick}%
          </text>
        </g>
      ))}
    </>
  );
}

function ChartDateLabels({
  dateLabels,
  numPoints,
  xPos,
}: {
  dateLabels: string[];
  numPoints: number;
  xPos: (i: number) => number;
}) {
  const step = Math.ceil(numPoints / 7);
  return (
    <>
      {dateLabels.map((date, i) => {
        const showLabel =
          numPoints <= 7 ||
          i === 0 ||
          i === numPoints - 1 ||
          i % step === 0;
        if (!showLabel) return null;
        return (
          <text
            key={`xlabel-${date}`}
            x={xPos(i)}
            y={CHART_HEIGHT - 2}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={8}
          >
            {date.slice(5)}
          </text>
        );
      })}
    </>
  );
}

function ChartSeriesLines({
  seriesList,
  xPos,
  yPos,
}: {
  seriesList: AgentSeries[];
  xPos: (i: number) => number;
  yPos: (v: number) => number;
}) {
  return (
    <>
      {seriesList.map((series, si) => {
        const color = colorForIndex(si);
        let isDrawing = false;
        const pathD = series.points
          .map((p, i) => {
            if (p.value === null) {
              isDrawing = false;
              return "";
            }
            const cmd = isDrawing ? "L" : "M";
            isDrawing = true;
            return `${cmd} ${xPos(i)} ${yPos(p.value)}`;
          })
          .filter(Boolean)
          .join(" ");
        return (
          <g key={series.agent}>
            {pathD ? (
              <path
                d={pathD}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
            ) : null}
            {series.points.map((p, i) =>
              p.value === null ? null : (
                <circle
                  key={`${series.agent}-${p.date}`}
                  cx={xPos(i)}
                  cy={yPos(p.value)}
                  r={2.5}
                  fill={color}
                >
                  <title>
                    {series.agent}: {p.value}% on{" "}
                    {p.date}
                  </title>
                </circle>
              ),
            )}
          </g>
        );
      })}
    </>
  );
}

function ChartLegend({
  seriesList,
}: {
  seriesList: AgentSeries[];
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-3">
      {seriesList.map((series, si) => (
        <div
          key={series.agent}
          className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{
              backgroundColor:
                colorForIndex(si),
            }}
          />
          {series.agent}
          {series.n != null && (
            <span className="text-muted-foreground/60">
              {" "}n={series.n}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
