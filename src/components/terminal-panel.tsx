"use client";

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
import {
  useTerminalPanelState,
} from "@/hooks/use-terminal-panel-state";

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

  if (terminals.length === 0) return null;
  if (!panelOpen) {
    return <MinimizedTerminalBar />;
  }

  return (
    <div
      className={
        "fixed bottom-0 left-0 right-0 z-40"
        + " flex flex-col border-t border-border"
        + " bg-[#1a1a2e]"
      }
      style={{ height: `${panelHeight}vh` }}
    >
      <div className={
        "flex items-center justify-between"
        + " gap-2 border-b border-white/10"
        + " bg-[#16162a] px-3 py-1.5"
      }>
        <div className={
          "flex min-w-0 flex-1"
          + " items-center gap-2"
        }>
          <TerminalTabStrip
            terminals={terminals}
            activeSessionId={activeTerminal?.sessionId}
            pendingClose={pendingClose}
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
          onAbort={handleAbort}
          onToggleMaximize={toggleMaximize}
          onClose={closePanel}
        />
      </div>

      {agentInfo && (
        <AgentInfoBar
          agent={agentInfo}
          beat={beatInfoForBar}
        />
      )}

      <div
        ref={termContainerRef}
        className={
          "flex-1 overflow-hidden px-1 py-1"
        }
      />
    </div>
  );
}
