"use client";

// Per MIGRATION.md §3.2: idle=moss-400, working=ochre-400, error=rust-500,
// each with a low-intensity glow matching its palette.
const STATUS_COLORS: Record<string, string> = {
  running: "bg-ochre-400",
  completed: "bg-moss-500",
  error: "bg-rust-500",
  aborted: "bg-ochre-500",
  idle: "bg-moss-400",
  disconnected: "bg-ochre-500",
};

interface TerminalStatusIndicatorProps {
  status: string;
}

export function TerminalStatusIndicator(
  props: TerminalStatusIndicatorProps,
) {
  const { status } = props;

  if (status === "running") {
    return (
      <span
        className={
          "inline-block size-2 shrink-0"
          + " rounded-full bg-ochre-400"
          + " shadow-[0_0_8px_oklch(0.762_0.115_82_/_0.7)]"
          + " animate-pulse"
        }
        title="running"
      />
    );
  }

  if (status === "aborted") {
    return (
      <span className={
        "shrink-0 text-[11px] font-semibold"
        + " uppercase tracking-wide text-rust-400"
      }>
        [terminated]
      </span>
    );
  }

  if (status === "completed") {
    return (
      <span
        className={
          "inline-block size-2 shrink-0"
          + " rounded-full bg-moss-500"
        }
        title="completed"
      />
    );
  }

  if (status === "disconnected") {
    return (
      <span className={
        "shrink-0 text-[11px] font-semibold"
        + " uppercase tracking-wide"
        + " text-ochre-400"
      }>
        [disconnected]
      </span>
    );
  }

  return (
    <span
      className={
        "inline-block size-2 shrink-0"
        + " rounded-full"
        + ` ${STATUS_COLORS[status]
          ?? STATUS_COLORS.idle}`
      }
      title={status}
    />
  );
}
