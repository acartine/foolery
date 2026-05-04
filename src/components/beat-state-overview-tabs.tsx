"use client";

import type {
  OverviewStateTabId,
  OverviewStateTabSummary,
} from "@/lib/beat-state-overview";

export function BeatStateOverviewTabs({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: OverviewStateTabSummary[];
  activeTab: OverviewStateTabId;
  onTabChange: (tabId: OverviewStateTabId) => void;
}) {
  return (
    <div
      className={
        "flex min-w-0 gap-1 overflow-x-auto border-b"
        + " border-border/70 pb-2"
      }
      role="tablist"
      aria-label="Beat state groups"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === activeTab}
          data-testid={`beat-overview-tab-${tab.id}`}
          className={tabClassName(tab.id === activeTab)}
          onClick={() => onTabChange(tab.id)}
        >
          <span>{tab.label}</span>
          <span
            className={
              "rounded-sm bg-background px-1.5 py-0.5"
              + " text-[10px] tabular-nums text-muted-foreground"
            }
          >
            {tab.count}
          </span>
        </button>
      ))}
    </div>
  );
}

function tabClassName(active: boolean): string {
  return [
    "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm",
    "border px-2 text-[11px] font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "border-clay-300 bg-clay-100 text-clay-800"
      : "border-border/70 bg-background text-muted-foreground",
    active ? "" : "hover:bg-muted/50 hover:text-foreground",
  ].filter(Boolean).join(" ");
}
