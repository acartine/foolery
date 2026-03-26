"use client";

const STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-400",
  completed: "bg-green-500",
  error: "bg-red-500",
  aborted: "bg-yellow-500",
  idle: "bg-gray-500",
  disconnected: "bg-orange-500",
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
          + " rounded-full bg-blue-400"
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
        + " uppercase tracking-wide text-red-400"
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
          + " rounded-full bg-green-500"
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
        + " text-orange-400"
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
