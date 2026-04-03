"use client";

import { useState, useEffect, useRef } from "react";
import type { Beat } from "@/lib/types";
import {
  capsuleMeta,
  type RenderedCapsule,
} from "@/components/beat-table-metadata";
import { PerfProfiler } from "@/components/perf-profiler";

function SummaryColumn({
  label,
  text,
  bg,
  rounded,
  expanded,
  onExpand,
}: {
  label: string;
  text: string;
  bg: string;
  rounded: string;
  expanded: boolean;
  onExpand: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frameId = 0;
    const updateOverflow = () => {
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    frameId = requestAnimationFrame(updateOverflow);
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(updateOverflow);
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [text]);

  return (
    <div className={`min-w-0 ${rounded} px-2 py-1 ${bg}`}>
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        ref={ref}
        className={`whitespace-pre-wrap break-words ${
          expanded ? "" : "line-clamp-[7]"
        }`}
      >
        {text}
      </div>
      {!expanded && overflows && (
        <button
          type="button"
          title="Expand full text"
          className="text-green-700 font-bold cursor-pointer mt-0.5"
          onMouseEnter={onExpand}
        >
          ...show more...
        </button>
      )}
    </div>
  );
}

function HandoffCapsulesColumn({
  capsules,
  expanded,
  onExpand,
}: {
  capsules: RenderedCapsule[];
  expanded: boolean;
  onExpand: () => void;
}) {
  const canExpand =
    capsules.length > 2 ||
    capsules.some((c) => c.content.length > 280);
  const visible = expanded
    ? capsules
    : capsules.slice(0, 2);

  return (
    <div className="min-w-0 rounded-b bg-blue-50 px-2 py-1 md:rounded-b-none xl:rounded-r">
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-800">
        Handoff Capsules
      </div>
      {visible.length > 0 ? (
        <div className="space-y-1">
          {visible.map((capsule) => {
            const meta = capsuleMeta(capsule.entry);
            return (
              <div
                key={capsule.key}
                className="rounded bg-white/70 px-1.5 py-1"
              >
                {meta && (
                  <div className="mb-0.5 text-[10px] text-muted-foreground">
                    {meta}
                  </div>
                )}
                <div
                  className={`whitespace-pre-wrap break-words ${
                    expanded ? "" : "line-clamp-[4]"
                  }`}
                >
                  {capsule.content}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-muted-foreground">-</div>
      )}
      {!expanded && canExpand && (
        <button
          type="button"
          title="Expand handoff capsules"
          className="mt-0.5 cursor-pointer font-bold text-green-700"
          onMouseEnter={onExpand}
        >
          ...show more...
        </button>
      )}
    </div>
  );
}

export function InlineSummary({
  beat,
  capsules,
}: {
  beat: Beat;
  capsules: RenderedCapsule[];
}) {
  const [expanded, setExpanded] = useState(false);
  if (
    !beat.description &&
    !beat.acceptance &&
    !beat.notes &&
    capsules.length === 0
  ) {
    return null;
  }

  const gridCls = [
    "mt-1.5 grid w-full max-w-full",
    "grid-cols-1 md:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))]",
    "gap-1 text-xs leading-relaxed",
    expanded ? "relative z-10" : "",
  ].join(" ");

  return (
    <PerfProfiler id="inline-summary" interactionLabel="summary">
      <div
        className={gridCls}
        onMouseLeave={() => setExpanded(false)}
      >
        <SummaryColumn
          label="Description"
          text={beat.description || ""}
          bg="bg-green-50"
          rounded="rounded-t md:rounded-t-none xl:rounded-l"
          expanded={expanded}
          onExpand={() => {
            performance.mark("inline-summary:expand");
            setExpanded(true);
          }}
        />
        <SummaryColumn
          label="Acceptance criteria"
          text={beat.acceptance || ""}
          bg={beat.acceptance ? "bg-emerald-50" : ""}
          rounded="rounded-none"
          expanded={expanded}
          onExpand={() => {
            performance.mark("inline-summary:expand");
            setExpanded(true);
          }}
        />
        <SummaryColumn
          label="Notes"
          text={beat.notes || ""}
          bg={beat.notes ? "bg-yellow-50" : ""}
          rounded="rounded-none"
          expanded={expanded}
          onExpand={() => {
            performance.mark("inline-summary:expand");
            setExpanded(true);
          }}
        />
        <HandoffCapsulesColumn
          capsules={capsules}
          expanded={expanded}
          onExpand={() => {
            performance.mark("inline-summary:expand");
            setExpanded(true);
          }}
        />
      </div>
    </PerfProfiler>
  );
}
