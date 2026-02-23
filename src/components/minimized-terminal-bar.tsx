"use client";

import { useTerminalStore } from "@/stores/terminal-store";

export function MinimizedTerminalBar() {
  const { terminals, restorePanel } = useTerminalStore();
  const runningCount = terminals.filter((t) => t.status === "running").length;

  if (terminals.length === 0) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 flex cursor-pointer items-center gap-2 border-t border-border bg-[#16162a] px-3 py-1.5 hover:bg-[#1e1e38]"
      onClick={restorePanel}
      title="Click to restore terminal panel (Shift+T)"
    >
      {runningCount > 0 && (
        <span className="inline-block size-2 rounded-full bg-blue-400 shadow-[0_0_8px_#60a5fa] animate-pulse" />
      )}
      <span className="text-[11px] text-white/70">
        {runningCount > 0
          ? `${runningCount} terminal${runningCount > 1 ? "s" : ""} running`
          : `${terminals.length} terminal${terminals.length > 1 ? "s" : ""}`}
      </span>
      <span className="truncate text-[11px] text-white/40">
        {terminals
          .map((t) =>
            t.beadIds
              ? `Scene (${t.beadIds.length})`
              : t.beadTitle || t.beadId
          )
          .join(", ")}
      </span>
    </div>
  );
}
