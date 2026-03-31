"use client";

import type { WheelEvent as ReactWheelEvent } from "react";
import { useRef } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { ActiveTerminal } from "@/stores/terminal-store";
import {
  resolveTerminalTabDisplayLabel,
} from "@/lib/terminal-tab-strip";
import {
  splitTerminalTabBeatId,
} from "@/lib/terminal-tab-id";

interface TerminalTabStripProps {
  terminals: ActiveTerminal[];
  activeSessionId: string | undefined;
  pendingClose: Set<string>;
  lightTheme: boolean;
  compactTabLabels: boolean;
  tabStripState: {
    hasOverflow: boolean;
    canScrollLeft: boolean;
    canScrollRight: boolean;
  };
  tabStripRef: React.RefObject<HTMLDivElement | null>;
  syncTabStripState: () => void;
  scrollTabStrip: (direction: -1 | 1) => void;
  handleTabStripWheel: (
    event: ReactWheelEvent<HTMLDivElement>,
  ) => void;
  handleTabClick: (sessionId: string) => void;
  removeTerminal: (sessionId: string) => void;
}

export function TerminalTabStrip(
  props: TerminalTabStripProps,
) {
  const {
    terminals,
    activeSessionId,
    pendingClose,
    lightTheme,
    compactTabLabels,
    tabStripState,
    tabStripRef,
    syncTabStripState,
    scrollTabStrip,
    handleTabStripWheel,
    handleTabClick,
    removeTerminal,
  } = props;

  const tabButtonRefs = useRef(
    new Map<string, HTMLButtonElement>(),
  );

  return (
    <div className={
      "flex min-w-0 flex-1 items-center gap-1"
    }>
      {tabStripState.hasOverflow && (
        <ScrollButton
          direction="left"
          lightTheme={lightTheme}
          disabled={!tabStripState.canScrollLeft}
          onClick={() => scrollTabStrip(-1)}
        />
      )}

      <div className="relative min-w-0 flex-1">
        <FadeEdge
          visible={tabStripState.hasOverflow}
          canScroll={tabStripState.canScrollLeft}
          side="left"
          lightTheme={lightTheme}
        />
        <div
          ref={tabStripRef}
          className={
            "scrollbar-hide flex min-w-0 flex-1"
            + " items-center gap-1 overflow-x-auto"
            + " pb-0.5"
          }
          onScroll={syncTabStripState}
          onWheel={handleTabStripWheel}
        >
          {terminals.map((terminal) => (
            <TerminalTab
              key={terminal.sessionId}
              terminal={terminal}
              isActive={
                terminal.sessionId === activeSessionId
              }
              isPending={
                pendingClose.has(terminal.sessionId)
              }
              lightTheme={lightTheme}
              compact={compactTabLabels}
              tabButtonRefs={tabButtonRefs}
              onClick={handleTabClick}
              onClose={removeTerminal}
            />
          ))}
        </div>
        <FadeEdge
          visible={tabStripState.hasOverflow}
          canScroll={tabStripState.canScrollRight}
          side="right"
          lightTheme={lightTheme}
        />
      </div>

      {tabStripState.hasOverflow && (
        <ScrollButton
          direction="right"
          lightTheme={lightTheme}
          disabled={!tabStripState.canScrollRight}
          onClick={() => scrollTabStrip(1)}
        />
      )}
    </div>
  );
}

/* ---- Sub-components ---- */

function ScrollButton(props: {
  direction: "left" | "right";
  lightTheme: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon =
    props.direction === "left"
      ? ChevronLeft
      : ChevronRight;
  const label =
    props.direction === "left"
      ? "Scroll terminal tabs left"
      : "Scroll terminal tabs right";
  const shortcut =
    props.direction === "left"
      ? "Scroll tabs left (Alt+Shift+Left)"
      : "Scroll tabs right (Alt+Shift+Right)";

  return (
    <button
      type="button"
      className={
        "shrink-0 rounded border p-1 transition-colors"
        + (props.lightTheme
          ? " border-slate-300 text-slate-500"
            + " enabled:hover:border-slate-400"
            + " enabled:hover:bg-slate-100"
            + " enabled:hover:text-slate-900"
          : " border-white/10 text-white/55"
            + " enabled:hover:border-white/30"
            + " enabled:hover:bg-white/10"
            + " enabled:hover:text-white")
        + " disabled:opacity-30"
      }
      aria-label={label}
      title={shortcut}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <Icon className="size-3.5" />
    </button>
  );
}

function FadeEdge(props: {
  visible: boolean;
  canScroll: boolean;
  side: "left" | "right";
  lightTheme: boolean;
}) {
  if (!props.visible) return null;
  const dirClass =
    props.side === "left"
      ? "left-0 bg-gradient-to-r"
      : "right-0 bg-gradient-to-l";
  return (
    <div
      className={
        "pointer-events-none absolute inset-y-0"
        + ` w-6 ${dirClass}`
        + (props.lightTheme
          ? " from-[#f0f0f0] to-transparent"
          : " from-[#16162a] to-transparent")
        + " transition-opacity"
        + ` ${props.canScroll
          ? "opacity-100"
          : "opacity-0"}`
      }
    />
  );
}

function TerminalTab(props: {
  terminal: ActiveTerminal;
  isActive: boolean;
  isPending: boolean;
  lightTheme: boolean;
  compact: boolean;
  tabButtonRefs: React.RefObject<
    Map<string, HTMLButtonElement>
  >;
  onClick: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
}) {
  const {
    terminal,
    isActive,
    isPending,
    lightTheme,
    compact,
    tabButtonRefs,
    onClick,
    onClose,
  } = props;
  const isRunning = terminal.status === "running";
  const beatIdParts = splitTerminalTabBeatId(terminal.beatId);
  const displayLabel =
    resolveTerminalTabDisplayLabel(
      beatIdParts,
      compact,
    );

  const widthClass = compact
    ? "max-w-[132px]"
    : "max-w-[270px]";

  const stateClass = isPending
    ? "animate-pulse border-amber-400/40"
      + " bg-amber-500/30 text-amber-200"
    : lightTheme
      ? isActive
        ? "border-slate-300 bg-white text-slate-900"
        : "border-transparent bg-slate-100"
          + " text-slate-600 hover:border-slate-300"
          + " hover:bg-slate-200 hover:text-slate-900"
      : isActive
        ? "border-white/25 bg-white/15 text-white"
        : "border-transparent bg-white/5"
          + " text-white/70 hover:border-white/20"
          + " hover:bg-white/10";

  const title = isPending
    ? "Click to keep open"
    : `${terminal.beatId}${
      terminal.beatTitle
        ? ` - ${terminal.beatTitle}`
        : ""
    }`;

  return (
    <button
      ref={(node) => {
        if (node) {
          tabButtonRefs.current.set(
            terminal.sessionId,
            node,
          );
        } else {
          tabButtonRefs.current.delete(
            terminal.sessionId,
          );
        }
      }}
      type="button"
      className={
        "group inline-flex shrink-0 items-center"
        + " gap-1.5 whitespace-nowrap rounded"
        + ` border px-2 py-1 text-[11px]`
        + ` transition-colors ${widthClass}`
        + ` ${stateClass}`
      }
      onClick={() => onClick(terminal.sessionId)}
      title={title}
    >
      <TabLabel
        displayLabel={displayLabel}
        compact={compact}
        beatTitle={terminal.beatTitle}
        lightTheme={lightTheme}
      />
      {isRunning ? (
        <span className={
          "inline-block size-1.5 shrink-0"
          + " rounded-full bg-blue-400"
          + " animate-pulse"
        } />
      ) : (
        <TabCloseIcon
          status={terminal.status}
          sessionId={terminal.sessionId}
          onClose={onClose}
        />
      )}
    </button>
  );
}

function TabLabel(props: {
  displayLabel: {
    prefix?: string | null;
    localId: string;
  };
  compact: boolean;
  beatTitle: string;
  lightTheme: boolean;
}) {
  const prefixCls = props.lightTheme
    ? "min-w-0 truncate text-slate-500"
    : "min-w-0 truncate text-white/45";
  const titleCls = props.lightTheme
    ? "max-w-[160px] truncate text-slate-600"
    : "max-w-[160px] truncate text-white/50";
  return (
    <>
      <span className={
        "flex min-w-0 items-center"
        + " gap-0.5 font-mono"
      }>
        {props.displayLabel.prefix ? (
          <>
            <span className={prefixCls}>
              {props.displayLabel.prefix}
            </span>
            <span className="shrink-0">
              {props.displayLabel.localId}
            </span>
          </>
        ) : (
          <span className="truncate">
            {props.displayLabel.localId}
          </span>
        )}
      </span>
      {!props.compact && props.beatTitle && (
        <span className={titleCls}>
          {props.beatTitle}
        </span>
      )}
    </>
  );
}

function TabCloseIcon(props: {
  status: string;
  sessionId: string;
  onClose: (sessionId: string) => void;
}) {
  const colorClass =
    props.status === "completed"
      ? "text-green-400 hover:bg-white/10"
        + " hover:text-green-300"
      : props.status === "disconnected"
        ? "text-orange-400 hover:bg-white/10"
          + " hover:text-orange-300"
        : "text-white/55 hover:bg-white/10"
          + " hover:text-white";

  return (
    <span
      className={`shrink-0 rounded p-0.5 ${
        colorClass
      }`}
      onClick={(event) => {
        event.stopPropagation();
        props.onClose(props.sessionId);
      }}
      title="Close tab"
    >
      <X className="size-3" />
    </span>
  );
}
