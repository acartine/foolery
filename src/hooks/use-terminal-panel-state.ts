"use client";

import {
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useMemo,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useTerminalStore,
  getActiveTerminal,
  type ActiveTerminal,
} from "@/stores/terminal-store";
import {
  detectVendor,
  useAgentInfo,
  type ResolvedAgentInfo,
} from "@/hooks/use-agent-info";
import {
  useTerminalAgentInfoMap,
} from "@/app/beats/use-terminal-agent-info";
import type {
  BeatInfoForBar,
} from "@/components/agent-info-bar";
import { fetchBeat } from "@/lib/api";
import { withClientPerfSpan } from "@/lib/client-perf";
import {
  useAutoCloseRefs,
  useTerminalAutoClose,
} from "@/hooks/use-terminal-auto-close";
import {
  useTerminalXterm,
} from "@/hooks/use-terminal-xterm";
import {
  useRehydrateTerminals,
  useTerminalFitEffects,
  useScrollActiveTab,
  useTabStripKeyboard,
} from "@/hooks/use-terminal-panel-effects";
import {
  useTabStripHelpers,
} from "@/hooks/use-terminal-tab-strip-state";
import {
  useTerminalThemePreference,
} from "@/hooks/use-terminal-theme-preference";
import type { Terminal as XtermTerminal }
  from "@xterm/xterm";

/** Everything the TerminalPanel render needs. */
export interface TerminalPanelState {
  panelOpen: boolean;
  panelHeight: number;
  terminals: ActiveTerminal[];
  activeTerminal: ReturnType<
    typeof getActiveTerminal
  >;
  pendingClose: Set<string>;
  closePanel: () => void;
  isMaximized: boolean;
  agentInfo: ResolvedAgentInfo | null;
  beatInfoForBar: BeatInfoForBar | null;
  thinkingDetailVisible: boolean;
  setThinkingDetailVisible: (v: boolean) => void;
  lightTheme: boolean;
  setLightTheme: (value: boolean) => void;
  tabStripRef: React.RefObject<
    HTMLDivElement | null
  >;
  tabStripState: {
    hasOverflow: boolean;
    canScrollLeft: boolean;
    canScrollRight: boolean;
  };
  compactTabLabels: boolean;
  syncTabStripState: () => void;
  scrollTabStrip: (direction: -1 | 1) => void;
  handleTabStripWheel: (
    event: ReactWheelEvent<HTMLDivElement>,
  ) => void;
  handleTabClick: (sessionId: string) => void;
  removeTerminal: (sessionId: string) => void;
  termContainerRef: React.RefObject<
    HTMLDivElement | null
  >;
  termRef: React.RefObject<
    XtermTerminal | null
  >;
  handleAbort: () => Promise<void>;
  toggleMaximize: () => void;
}

export function useTerminalPanelState(
): TerminalPanelState {
  const {
    panelOpen, panelHeight, terminals,
    activeSessionId, pendingClose, closePanel,
    setPanelHeight, setActiveSession,
    removeTerminal, upsertTerminal,
    markPendingClose, cancelPendingClose,
  } = useTerminalStore();
  const activeTerminal = useMemo(
    () => getActiveTerminal(
      terminals, activeSessionId,
    ),
    [activeSessionId, terminals],
  );
  const d = useDerivedState(
    activeTerminal, terminals,
  );
  const agentInfo = useAgentInfoFor(
    activeTerminal,
  );
  const beatInfoForBar = useBeatInfo(
    d.activeBeatId,
    activeTerminal?.repoPath,
    d.latestTakeStartedAt,
  );
  const [td, setTd] = useState(false);
  const [cae, setCae] = useState(false);
  const ts = useTabStripHelpers(
    terminals.length,
  );
  const themePref = useTerminalThemePreference();
  const toggleMaximize = useCallback(
    () => setPanelHeight(
      panelHeight > 70 ? 35 : 80,
    ),
    [panelHeight, setPanelHeight],
  );
  const ac = useAutoCloseRefs();
  useTerminalAutoClose(
    terminals, pendingClose,
    markPendingClose, removeTerminal, cae, ac,
  );
  useRehydrateTerminals(setCae);
  const handleTabClick = useTabClickHandler(
    cancelPendingClose, setActiveSession,
    ac.autoCloseTimers,
  );
  const xterm = useTerminalXterm({
    panelOpen,
    activeSessionKey:
      activeTerminal?.sessionId ?? null,
    activeBeatId: d.activeBeatId,
    activeBeatTitle: d.activeBeatTitle,
    activeRepoPath: activeTerminal?.repoPath,
    removeTerminal, upsertTerminal,
    agentCommand: agentInfo?.command,
    thinkingDetailVisible: td,
    lightTheme: themePref.lightTheme,
    recentOutputBySession:
      ac.recentOutputBySession,
    failureHintBySession:
      ac.failureHintBySession,
  });
  useTerminalFitEffects(
    panelOpen, panelHeight, xterm.fitRef,
    ts.syncTabStripState, terminals.length,
  );
  useScrollActiveTab(
    panelOpen,
    activeTerminal?.sessionId ?? null,
    ts.syncTabStripState, terminals.length,
  );
  useTabStripKeyboard(
    panelOpen,
    ts.tabStripState.hasOverflow,
    ts.scrollTabStrip,
  );
  return buildResult(
    panelOpen, panelHeight, terminals,
    activeTerminal, pendingClose, closePanel,
    agentInfo, beatInfoForBar, td, setTd,
    themePref, ts, handleTabClick, removeTerminal,
    xterm, toggleMaximize,
  );
}

function buildResult(
  panelOpen: boolean,
  panelHeight: number,
  terminals: ActiveTerminal[],
  activeTerminal: ReturnType<typeof getActiveTerminal>,
  pendingClose: Set<string>,
  closePanel: () => void,
  agentInfo: TerminalPanelState["agentInfo"],
  beatInfoForBar: TerminalPanelState["beatInfoForBar"],
  td: boolean,
  setTd: (v: boolean) => void,
  themePref: ReturnType<typeof useTerminalThemePreference>,
  ts: ReturnType<typeof useTabStripHelpers>,
  handleTabClick: (sid: string) => void,
  removeTerminal: (sid: string) => void,
  xterm: ReturnType<typeof useTerminalXterm>,
  toggleMaximize: () => void,
): TerminalPanelState {
  return {
    panelOpen, panelHeight, terminals,
    activeTerminal, pendingClose, closePanel,
    isMaximized: panelHeight > 70,
    agentInfo, beatInfoForBar,
    thinkingDetailVisible: td,
    setThinkingDetailVisible: setTd,
    lightTheme: themePref.lightTheme,
    setLightTheme: themePref.setLightTheme,
    tabStripRef: ts.tabStripRef,
    tabStripState: ts.tabStripState,
    compactTabLabels: ts.compactTabLabels,
    syncTabStripState: ts.syncTabStripState,
    scrollTabStrip: ts.scrollTabStrip,
    handleTabStripWheel: ts.handleTabStripWheel,
    handleTabClick, removeTerminal,
    termContainerRef: xterm.termContainerRef,
    termRef: xterm.termRef,
    handleAbort: xterm.handleAbort,
    toggleMaximize,
  };
}
function useTabClickHandler(
  cancelPendingClose: (sid: string) => void,
  setActiveSession: (sid: string) => void,
  timers: React.RefObject<
    Map<string, ReturnType<typeof setTimeout>>
  >,
) {
  return useCallback(
    (sid: string) => {
      cancelPendingClose(sid);
      clearAutoCloseTimer(timers, sid);
      setActiveSession(sid);
    },
    [setActiveSession, cancelPendingClose, timers],
  );
}

function clearAutoCloseTimer(
  timers: React.RefObject<
    Map<string, ReturnType<typeof setTimeout>>
  >,
  sid: string,
) {
  const t = timers.current.get(sid);
  if (t) {
    clearTimeout(t);
    timers.current.delete(sid);
  }
}

/* ---- Internal hooks ---- */

function useDerivedState(
  activeTerminal: ReturnType<
    typeof getActiveTerminal
  >,
  terminals: ActiveTerminal[],
) {
  const activeBeatId =
    activeTerminal?.beatId ?? null;
  const activeBeatTitle =
    activeTerminal?.beatTitle ?? null;
  const latestTakeStartedAt = useMemo(() => {
    if (!activeBeatId) {
      return activeTerminal?.startedAt;
    }
    let best: string | undefined;
    let bestMs = Number.NEGATIVE_INFINITY;
    for (const t of terminals) {
      if (t.beatId !== activeBeatId) continue;
      const ms = Date.parse(t.startedAt);
      if (!Number.isFinite(ms)) continue;
      if (ms > bestMs) {
        bestMs = ms;
        best = t.startedAt;
      }
    }
    return best ?? activeTerminal?.startedAt;
  }, [
    activeBeatId,
    activeTerminal?.startedAt,
    terminals,
  ]);
  return {
    activeBeatId,
    activeBeatTitle,
    latestTakeStartedAt,
  };
}

function useAgentInfoFor(
  activeTerminal: ReturnType<
    typeof getActiveTerminal
  >,
): ResolvedAgentInfo | null {
  const fallback = useAgentInfo("take");
  // Lease-derived agent identity for the active terminal.  See
  // `docs/knots-agent-identity-contract.md` rule 5 — runtime/session
  // metadata always comes from the autostamped lease, never from
  // duplicate fields on the terminal store.
  const leaseAgentInfoMap = useTerminalAgentInfoMap();
  const session = useMemo<
    ResolvedAgentInfo | null
  >(() => {
    if (!activeTerminal) return null;
    const info = leaseAgentInfoMap.get(activeTerminal.sessionId);
    if (!info?.agentName) return null;
    return {
      name: info.agentName,
      model: info.agentModel,
      version: info.agentVersion,
      command: info.agentName,
      vendor: detectVendor(info.agentName),
    };
  }, [activeTerminal, leaseAgentInfoMap]);
  return session ?? fallback;
}

function useBeatInfo(
  activeBeatId: string | null,
  activeRepoPath: string | undefined,
  latestTakeStartedAt: string | undefined,
): BeatInfoForBar | null {
  const beatQuery = useQuery({
    queryKey: [
      "beat", activeBeatId, activeRepoPath,
    ],
    queryFn: () => withClientPerfSpan(
      "query",
      "terminal-panel:beat",
      () => activeBeatId
        ? fetchBeat(activeBeatId, activeRepoPath)
        : Promise.resolve({ ok: true, data: undefined }),
    ),
    enabled: true,
    refetchInterval: 15_000,
  });
  return useMemo<BeatInfoForBar | null>(() => {
    const beat = beatQuery.data?.data;
    if (!beat) return null;
    return {
      state: beat.state,
      stateChangedAt: beat.updated,
      createdAt: beat.created,
      latestTakeStartedAt,
    };
  }, [
    beatQuery.data?.data,
    latestTakeStartedAt,
  ]);
}
