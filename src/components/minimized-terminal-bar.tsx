"use client";

import {
  MINIMIZED_TERMINAL_BAR_HEIGHT_PX,
} from "@/lib/terminal-viewport";
import { useTerminalStore } from "@/stores/terminal-store";

export function MinimizedTerminalBar() {
  const { terminals, restorePanel } = useTerminalStore();
  const runningCount = terminals.filter((t) => t.status === "running").length;

  if (terminals.length === 0) return null;

  return (
    <div
      className={
        "fixed bottom-0 left-0 right-0 z-40 flex"
        + " cursor-pointer items-center gap-2 border-t"
        + " border-walnut-100 bg-walnut-400/90 px-3 py-1.5"
        + " backdrop-blur-sm hover:bg-walnut-300/90"
      }
      style={{
        height: `${MINIMIZED_TERMINAL_BAR_HEIGHT_PX}px`,
      }}
      onClick={restorePanel}
      title="Click to restore terminal panel (Shift+T)"
    >
      {runningCount > 0 && (
        <span className="inline-block size-2 rounded-full bg-ochre-400 shadow-[0_0_8px_oklch(0.762_0.115_82_/_0.7)] animate-pulse" />
      )}
      <span className="text-[11px] text-paper-300">
        {runningCount > 0
          ? `${runningCount} terminal${runningCount > 1 ? "s" : ""} running`
          : `${terminals.length} terminal${terminals.length > 1 ? "s" : ""}`}
      </span>
      <span className="truncate text-[11px] text-paper-400">
        {terminals
          .map((t) =>
            t.beatIds
              ? `Scene (${t.beatIds.length})`
              : t.beatTitle || t.beatId
          )
          .join(", ")}
      </span>
    </div>
  );
}
