"use client";

import { useEffect, useRef } from "react";
import { useTerminalStore } from "@/stores/terminal-store";
import type { ActiveTerminal } from "@/stores/terminal-store";
import {
  createCompletionAnimationTracker,
  pruneCompletionAnimationTracker,
  shouldAnimateCompletion,
} from "@/lib/terminal-tab-completion";
import type { TerminalFailureGuidance } from "@/lib/terminal-failure";

const AUTO_CLOSE_MS = 30_000;

interface AutoCloseRefs {
  autoCloseTimers: React.RefObject<
    Map<string, ReturnType<typeof setTimeout>>
  >;
  completionAnimationTracker: React.RefObject<
    ReturnType<typeof createCompletionAnimationTracker>
  >;
  recentOutputBySession: React.RefObject<
    Map<string, string>
  >;
  failureHintBySession: React.RefObject<
    Map<string, TerminalFailureGuidance>
  >;
}

export function useAutoCloseRefs(): AutoCloseRefs {
  const autoCloseTimers = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const completionAnimationTracker = useRef(
    createCompletionAnimationTracker()
  );
  const recentOutputBySession = useRef<
    Map<string, string>
  >(new Map());
  const failureHintBySession = useRef<
    Map<string, TerminalFailureGuidance>
  >(new Map());

  return {
    autoCloseTimers,
    completionAnimationTracker,
    recentOutputBySession,
    failureHintBySession,
  };
}

/**
 * Manages auto-close timers for completed terminal tabs.
 */
export function useTerminalAutoClose(
  terminals: ActiveTerminal[],
  pendingClose: Set<string>,
  markPendingClose: (sid: string) => void,
  removeTerminal: (sid: string) => void,
  animEnabled: boolean,
  refs: AutoCloseRefs,
): void {
  useEffect(
    () => syncAutoClose(
      terminals, pendingClose, markPendingClose,
      removeTerminal, animEnabled, refs,
    ),
    [
      terminals, pendingClose, markPendingClose,
      removeTerminal, animEnabled, refs,
    ],
  );
  useEffect(
    () => cleanupOnUnmount(refs),
    [refs],
  );
}

function syncAutoClose(
  terminals: ActiveTerminal[],
  pendingClose: Set<string>,
  markPendingClose: (sid: string) => void,
  removeTerminal: (sid: string) => void,
  animEnabled: boolean,
  refs: AutoCloseRefs,
) {
  const {
    autoCloseTimers: at,
    completionAnimationTracker: cat,
    recentOutputBySession: ros,
    failureHintBySession: fhs,
  } = refs;
  const ids = new Set(
    terminals.map((t) => t.sessionId),
  );
  for (const t of terminals) {
    const sid = t.sessionId;
    const done = t.status === "completed";
    const pending = pendingClose.has(sid);
    const hasT = at.current.has(sid);
    const pulse = shouldAnimateCompletion(
      cat.current, sid, t.status,
      { allowAnimation: animEnabled },
    );
    if (pulse && !pending && !hasT) {
      markPendingClose(sid);
      const timer = setTimeout(() => {
        at.current.delete(sid);
        if (
          useTerminalStore.getState()
            .pendingClose.has(sid)
        ) removeTerminal(sid);
      }, AUTO_CLOSE_MS);
      at.current.set(sid, timer);
    }
    if (!done || (!pending && hasT)) {
      const ex = at.current.get(sid);
      if (ex) {
        clearTimeout(ex);
        at.current.delete(sid);
      }
    }
  }
  for (const [sid, timer] of at.current) {
    if (!ids.has(sid)) {
      clearTimeout(timer);
      at.current.delete(sid);
    }
  }
  pruneCompletionAnimationTracker(
    cat.current, ids,
  );
  for (const sid of ros.current.keys()) {
    if (!ids.has(sid)) {
      ros.current.delete(sid);
      fhs.current.delete(sid);
    }
  }
}

function cleanupOnUnmount(refs: AutoCloseRefs) {
  const t = refs.autoCloseTimers.current;
  const c = refs.completionAnimationTracker.current;
  const o = refs.recentOutputBySession.current;
  const h = refs.failureHintBySession.current;
  return () => {
    for (const timer of t.values()) {
      clearTimeout(timer);
    }
    t.clear();
    c.seenSessionIds.clear();
    c.previousStatusBySession.clear();
    o.clear();
    h.clear();
  };
}
