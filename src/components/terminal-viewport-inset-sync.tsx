"use client";

import { useEffect } from "react";
import {
  getTerminalViewportInset,
} from "@/lib/terminal-viewport";
import { useTerminalStore } from "@/stores/terminal-store";

const TERMINAL_VIEWPORT_INSET_VAR =
  "--terminal-viewport-inset";

export function TerminalViewportInsetSync() {
  const {
    panelOpen,
    panelMinimized,
    panelHeight,
    terminals,
  } = useTerminalStore();

  useEffect(() => {
    const inset = getTerminalViewportInset({
      panelOpen,
      panelMinimized,
      panelHeight,
      terminalCount: terminals.length,
    });
    document.body.style.setProperty(
      TERMINAL_VIEWPORT_INSET_VAR,
      inset,
    );

    return () => {
      document.body.style.removeProperty(
        TERMINAL_VIEWPORT_INSET_VAR,
      );
    };
  }, [
    panelHeight,
    panelMinimized,
    panelOpen,
    terminals.length,
  ]);

  return null;
}
