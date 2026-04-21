"use client";

const STATUS_COLORS: Record<string, string> = {
  running: "bg-lake-400",
  completed: "bg-moss-500",
  error: "bg-rust-500",
  aborted: "bg-ochre-500",
  idle: "bg-paper-500",
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
          + " rounded-full bg-lake-400"
          + " shadow-[0_0_8px_#60a5fa]"
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
