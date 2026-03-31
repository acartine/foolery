"use client";

import {
  useAgentHistoryState,
} from "@/hooks/use-agent-history-state";
import { PerfProfiler } from "@/components/perf-profiler";
import {
  AgentHistoryTopPanel,
} from "./agent-history-top-panel";
import {
  AgentHistoryConversationLog,
} from "./agent-history-conversation-log";

export function AgentHistoryView() {
  const state = useAgentHistoryState();

  if (
    !state.activeRepo
    && state.registeredRepos.length === 0
  ) {
    return (
      <div className={
        "flex items-center justify-center"
        + " py-10 text-[13px]"
        + " text-muted-foreground"
      }>
        Add a repository to view agent history.
      </div>
    );
  }

  return (
    <PerfProfiler id="agent-history-view" interactionLabel="history">
      <div className="space-y-2">
        <AgentHistoryTopPanel
          beats={state.beats}
          visibleBeats={state.visibleBeats}
          windowStart={state.windowStart}
          focusedBeatKey={state.focusedBeatKey}
          loadedBeatKey={state.loadedBeatKey}
          setFocusedBeatKey={
            state.setFocusedBeatKey
          }
          setLoadedBeatKey={state.setLoadedBeatKey}
          moveFocusedBeat={state.moveFocusedBeat}
          focusBeatList={state.focusBeatList}
          focusConsolePanel={
            state.focusConsolePanel
          }
          copyBeatId={state.copyBeatId}
          getBeatTitle={state.getBeatTitle}
          beatButtonRefs={state.beatButtonRefs}
          beatListRef={state.beatListRef}
          beatsQuery={state.beatsQuery}
          beatDetailMap={state.beatDetailMap}
          focusedSummary={state.focusedSummary}
          focusedDetail={state.focusedDetail}
          focusedTitle={state.focusedTitle}
          showExpandedDetails={
            state.showExpandedDetails
          }
          setShowExpandedDetails={
            state.setShowExpandedDetails
          }
          showRepoName={state.showRepoName}
          repoNames={state.repoNames}
        />
        <AgentHistoryConversationLog
          loadedSummary={state.loadedSummary}
          loadedTitle={state.loadedTitle}
          loadedDetail={state.loadedDetail}
          sessions={state.sessions}
          sessionsQuery={state.sessionsQuery}
          picker={state.picker}
          selectedDebugSession={
            state.selectedDebugSession
          }
          selectedSessionId={
            state.selectedSessionId
          }
          setSelectedSessionId={
            state.setSelectedSessionId
          }
          activeTab={state.activeTab}
          setActiveTab={state.setActiveTab}
          copyBeatId={state.copyBeatId}
          consolePanelRef={state.consolePanelRef}
          beatListRef={state.beatListRef}
        />
      </div>
    </PerfProfiler>
  );
}
