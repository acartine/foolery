"use client";

import { useEffect } from "react";
import {
  AgentInfoBar,
} from "@/components/agent-info-bar";
import {
  MinimizedTerminalBar,
} from "@/components/minimized-terminal-bar";
import {
  TerminalTabStrip,
} from "@/components/terminal-tab-strip-ui";
import {
  TerminalToolbar,
} from "@/components/terminal-toolbar";
import {
  TerminalStatusIndicator,
} from "@/components/terminal-status-indicator";
import { PerfProfiler } from "@/components/perf-profiler";
import {
  useTerminalPanelState,
} from "@/hooks/use-terminal-panel-state";
import { cn } from "@/lib/utils";

const DARK_BG = "bg-walnut-300";
const LIGHT_BG = "bg-paper-100";
const DARK_HEADER = "bg-walnut-400";
const LIGHT_HEADER = "bg-paper-200";

function getTerminalPanelThemeClasses(lightTheme: boolean) {
  return {
    panel: lightTheme ? LIGHT_BG : DARK_BG,
    panelBorder: lightTheme
      ? "border-t border-paper-300"
      : "border-t border-walnut-100",
    header: lightTheme ? LIGHT_HEADER : DARK_HEADER,
    headerBorder: lightTheme
      ? "border-b border-paper-200"
      : "border-b border-walnut-100",
    text: lightTheme ? "text-ink-900" : "text-paper-200",
  };
}

export function TerminalPanel() {
  const {
    panelOpen,
    panelHeight,
    terminals,
    activeTerminal,
    pendingClose,
    closePanel,
    isMaximized,
    agentInfo,
    beatInfoForBar,
    thinkingDetailVisible,
    setThinkingDetailVisible,
    lightTheme,
    setLightTheme,
    tabStripRef,
    tabStripState,
    compactTabLabels,
    syncTabStripState,
    scrollTabStrip,
    handleTabStripWheel,
    handleTabClick,
    removeTerminal,
    termContainerRef,
    termRef,
    handleAbort,
    toggleMaximize,
  } = useTerminalPanelState();
  const theme = getTerminalPanelThemeClasses(lightTheme);

  useEffect(() => { if (terminals.length > 0) performance.mark("terminal-panel:mount"); }, [terminals.length]);
  if (terminals.length === 0) return null;
  if (!panelOpen) return <MinimizedTerminalBar />;

  return (
    <PerfProfiler id="terminal-panel" interactionLabel="terminal">
      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 z-40 flex flex-col",
          theme.panelBorder,
          theme.panel,
        )}
        style={{ height: `${panelHeight}vh` }}
      >
      <div className={cn(
        "flex items-center justify-between gap-2 px-3 py-1.5",
        theme.headerBorder,
        theme.header,
      )}>
        <div className={cn(
          "flex min-w-0 flex-1 items-center gap-2",
          theme.text,
        )}>
          <TerminalTabStrip
            terminals={terminals}
            activeSessionId={activeTerminal?.sessionId}
            pendingClose={pendingClose}
            lightTheme={lightTheme}
            compactTabLabels={compactTabLabels}
            tabStripState={tabStripState}
            tabStripRef={tabStripRef}
            syncTabStripState={syncTabStripState}
            scrollTabStrip={scrollTabStrip}
            handleTabStripWheel={handleTabStripWheel}
            handleTabClick={handleTabClick}
            removeTerminal={removeTerminal}
          />
          {activeTerminal && (
            <TerminalStatusIndicator
              status={activeTerminal.status}
            />
          )}
        </div>
        <TerminalToolbar
          termRef={termRef}
          isRunning={activeTerminal?.status === "running"}
          isMaximized={isMaximized}
          thinkingDetailVisible={thinkingDetailVisible}
          setThinkingDetailVisible={setThinkingDetailVisible}
          lightTheme={lightTheme}
          onLightThemeChange={setLightTheme}
          onAbort={handleAbort}
          onToggleMaximize={toggleMaximize}
          onClose={closePanel}
        />
      </div>
      {agentInfo && (
        <AgentInfoBar
          agent={agentInfo}
          beat={beatInfoForBar}
          lightTheme={lightTheme}
        />
      )}
      <div
        ref={termContainerRef}
        className="flex-1 overflow-hidden px-1 py-1"
      />
      </div>
    </PerfProfiler>
  );
}
