"use client";

import { CircleDot } from "lucide-react";
import { getMemoryManagerLabel } from "@/lib/memory-managers";

export function MemoryManagerBadge({ type }: { type?: string }) {
  const label = getMemoryManagerLabel(type);
  const isKnown = type && label !== "Unknown";
  return (
    <span
      className={
        isKnown
          ? "inline-flex items-center gap-1 text-xs text-moss-600 bg-moss-100 dark:bg-moss-700 dark:text-moss-400 px-2 py-0.5 rounded-full shrink-0"
          : "inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0"
      }
    >
      <CircleDot className="size-3" />
      {label}
    </span>
  );
}
