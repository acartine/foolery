"use client";

import { useEffect, useRef } from "react";
import { useTerminalStore } from "@/stores/terminal-store";
import { listSessions } from "@/lib/terminal-api";
import type { FitAddon as XtermFitAddon }
  from "@xterm/addon-fit";

const SESSION_DISCOVERY_INTERVAL_MS = 5_000;

export function useRehydrateTerminals(
  setEnabled: (v: boolean) => void,
) {
  const hasRehydrated = useRef(false);

  useEffect(() => {
    if (hasRehydrated.current) return;
    hasRehydrated.current = true;
    let cancelled = false;
    const syncSessions = async () => {
      const sessions = await listSessions();
      if (cancelled) return;
      useTerminalStore
        .getState()
        .rehydrateFromBackend(sessions);
    };

    void syncSessions().finally(() => {
      if (!cancelled) setEnabled(true);
    });

    const intervalId = setInterval(() => {
      void syncSessions();
    }, SESSION_DISCOVERY_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
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
