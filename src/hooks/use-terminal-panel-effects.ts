"use client";

import { useEffect, useRef } from "react";
import { useTerminalStore } from "@/stores/terminal-store";
import { listSessions } from "@/lib/terminal-api";
import type { FitAddon as XtermFitAddon }
  from "@xterm/addon-fit";

export function useRehydrateTerminals(
  setEnabled: (v: boolean) => void,
) {
  const hasRehydrated = useRef(false);

  useEffect(() => {
    if (hasRehydrated.current) return;
    hasRehydrated.current = true;
    let cancelled = false;
    const enable = () => {
      if (!cancelled) setEnabled(true);
    };
    const { terminals } =
      useTerminalStore.getState();
    if (terminals.length === 0) {
      enable();
      return () => { cancelled = true; };
    }
    listSessions()
      .then((sessions) => {
        useTerminalStore
          .getState()
          .rehydrateFromBackend(sessions);
      })
      .finally(enable);
    return () => { cancelled = true; };
  }, [setEnabled]);
}

export function useTerminalFitEffects(
  panelOpen: boolean,
  panelHeight: number,
  fitRef: React.RefObject<XtermFitAddon | null>,
  syncTabStripState: () => void,
  terminalCount: number,
) {
  useEffect(() => {
    if (!panelOpen || !fitRef.current) return;
    const t = setTimeout(
      () => fitRef.current?.fit(), 100,
    );
    return () => clearTimeout(t);
  }, [panelOpen, panelHeight, fitRef]);

  useEffect(() => {
    if (!panelOpen) return;
    const h = () => {
      fitRef.current?.fit();
      syncTabStripState();
    };
    window.addEventListener("resize", h);
    return () =>
      window.removeEventListener("resize", h);
  }, [panelOpen, syncTabStripState, fitRef]);

  useEffect(() => {
    if (!panelOpen) return;
    const f = requestAnimationFrame(
      syncTabStripState,
    );
    return () => cancelAnimationFrame(f);
  }, [
    panelOpen,
    panelHeight,
    terminalCount,
    syncTabStripState,
  ]);
}

export function useScrollActiveTab(
  panelOpen: boolean,
  activeSessionKey: string | null,
  syncTabStripState: () => void,
  terminalCount: number,
) {
  useEffect(() => {
    if (!panelOpen || !activeSessionKey) return;
    const f = requestAnimationFrame(
      syncTabStripState,
    );
    return () => cancelAnimationFrame(f);
  }, [
    activeSessionKey,
    panelOpen,
    syncTabStripState,
    terminalCount,
  ]);
}

export function useTabStripKeyboard(
  panelOpen: boolean,
  hasOverflow: boolean,
  scrollTabStrip: (direction: -1 | 1) => void,
) {
  useEffect(() => {
    if (!panelOpen || !hasOverflow) return;
    const handleKeyDown = (
      e: KeyboardEvent,
    ) => {
      const t =
        e.target as HTMLElement | null;
      const isInput =
        t instanceof HTMLInputElement
        || t instanceof HTMLTextAreaElement
        || t?.isContentEditable;
      if (isInput) return;
      if (
        e.altKey && e.shiftKey
        && e.key === "ArrowLeft"
      ) {
        e.preventDefault();
        scrollTabStrip(-1);
      }
      if (
        e.altKey && e.shiftKey
        && e.key === "ArrowRight"
      ) {
        e.preventDefault();
        scrollTabStrip(1);
      }
    };
    window.addEventListener(
      "keydown", handleKeyDown,
    );
    return () => window.removeEventListener(
      "keydown", handleKeyDown,
    );
  }, [panelOpen, scrollTabStrip, hasOverflow]);
}
