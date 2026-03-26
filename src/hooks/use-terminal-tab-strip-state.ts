"use client";

import {
  type WheelEvent as ReactWheelEvent,
  useRef,
  useCallback,
  useState,
} from "react";
import {
  getTerminalTabScrollAmount,
  resolveTerminalTabStripState,
  shouldUseCompactTerminalTabLabels,
} from "@/lib/terminal-tab-strip";

export function useTabStripHelpers(
  terminalCount: number,
) {
  const tabStripRef =
    useRef<HTMLDivElement>(null);
  const [tabStripState, setTabStripState] =
    useState(() => resolveTerminalTabStripState({
      scrollLeft: 0,
      scrollWidth: 0,
      clientWidth: 0,
    }));
  const [compactTabLabels, setCompactTabLabels] =
    useState(false);

  const syncTabStripState = useCallback(() => {
    const strip = tabStripRef.current;
    if (!strip) {
      setTabStripState(
        resolveTerminalTabStripState({
          scrollLeft: 0,
          scrollWidth: 0,
          clientWidth: 0,
        }),
      );
      setCompactTabLabels(false);
      return;
    }
    const next = resolveTerminalTabStripState({
      scrollLeft: strip.scrollLeft,
      scrollWidth: strip.scrollWidth,
      clientWidth: strip.clientWidth,
    });
    setTabStripState(next);
    setCompactTabLabels(
      shouldUseCompactTerminalTabLabels(
        next.hasOverflow,
        strip.clientWidth,
        terminalCount,
      ),
    );
  }, [terminalCount]);

  const scrollTabStrip = useCallback(
    (direction: -1 | 1) => {
      const strip = tabStripRef.current;
      if (!strip) return;
      const amount = getTerminalTabScrollAmount(
        strip.clientWidth,
      );
      strip.scrollBy({
        left: direction * amount,
        behavior: "smooth",
      });
      requestAnimationFrame(syncTabStripState);
      window.setTimeout(syncTabStripState, 180);
    },
    [syncTabStripState],
  );

  const handleTabStripWheel = useCallback(
    (
      event: ReactWheelEvent<HTMLDivElement>,
    ) => {
      const strip = tabStripRef.current;
      if (
        !strip || !tabStripState.hasOverflow
      ) {
        return;
      }
      if (
        Math.abs(event.deltaY)
        <= Math.abs(event.deltaX)
      ) {
        return;
      }
      event.preventDefault();
      strip.scrollBy({ left: event.deltaY });
      syncTabStripState();
    },
    [
      syncTabStripState,
      tabStripState.hasOverflow,
    ],
  );

  return {
    tabStripRef,
    tabStripState,
    compactTabLabels,
    syncTabStripState,
    scrollTabStrip,
    handleTabStripWheel,
  };
}
