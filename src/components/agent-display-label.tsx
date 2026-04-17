"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  parseAgentDisplayParts,
  type AgentIdentityLike,
} from "@/lib/agent-identity";
import { cn } from "@/lib/utils";

interface AgentDisplayLabelProps {
  agent: AgentIdentityLike;
  layout?: "inline" | "stacked";
}

const PILL_CLASS =
  "text-[10px] px-1.5 py-0 h-4 font-normal shrink-0";
const GAP_PX = 6;

export function AgentDisplayLabel({
  agent,
  layout = "inline",
}: AgentDisplayLabelProps) {
  const { label, pills } = parseAgentDisplayParts(agent);

  if (layout === "stacked") {
    return (
      <span className="max-w-full min-w-0 inline-flex flex-col items-start gap-1">
        <span className="block max-w-full truncate">{label}</span>
        <span className="flex max-w-full flex-wrap items-center gap-1.5">
          {pills.map((pill) => (
            <Badge
              key={pill}
              variant="secondary"
              className={PILL_CLASS}
            >
              {pill}
            </Badge>
          ))}
        </span>
      </span>
    );
  }

  return <InlineAgentLabel label={label} pills={pills} />;
}

function InlineAgentLabel({
  label,
  pills,
}: {
  label: string;
  pills: string[];
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [visiblePillCount, setVisiblePillCount] = useState(pills.length);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const recompute = () => {
      const available = container.clientWidth;
      const children = Array.from(measure.children) as HTMLElement[];
      const [labelEl, ...pillEls] = children;
      if (!labelEl) return;
      const labelWidth = labelEl.getBoundingClientRect().width;
      if (labelWidth >= available) {
        setVisiblePillCount(0);
        return;
      }
      let used = labelWidth;
      let count = 0;
      for (const pillEl of pillEls) {
        const next = used + GAP_PX + pillEl.getBoundingClientRect().width;
        if (next > available) break;
        used = next;
        count += 1;
      }
      setVisiblePillCount(count);
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    return () => ro.disconnect();
  }, [label, pills]);

  return (
    <span
      ref={containerRef}
      className={cn(
        "relative inline-flex items-center gap-1.5 min-w-0 w-full overflow-hidden",
      )}
    >
      <span
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap"
      >
        <span>{label}</span>
        {pills.map((pill) => (
          <Badge
            key={pill}
            variant="secondary"
            className={PILL_CLASS}
          >
            {pill}
          </Badge>
        ))}
      </span>
      <span className="truncate min-w-0">{label}</span>
      {pills.slice(0, visiblePillCount).map((pill) => (
        <Badge
          key={pill}
          variant="secondary"
          className={PILL_CLASS}
        >
          {pill}
        </Badge>
      ))}
    </span>
  );
}
