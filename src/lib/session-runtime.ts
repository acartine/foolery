import type { EventEmitter } from "node:events";
import type { InteractionLog } from "@/lib/interaction-logger";
import type { AgentTarget } from "@/lib/types-agent-target";
import type { Beat, MemoryWorkflowDescriptor, TerminalEvent, TerminalSession } from "@/lib/types";

export interface RuntimeSessionContext {
  session: TerminalSession;
  repoPath?: string;
  beat: Beat;
  beatId: string;
  isParent: boolean;
  childBeatIds: string[];
  customPrompt?: string;
  queueTerminalInvariantInstruction: string;
  workflowsById: Map<string, MemoryWorkflowDescriptor>;
  fallbackWorkflow: MemoryWorkflowDescriptor;
  interactionLog: InteractionLog;
  emitter: EventEmitter;
  pushEvent: (event: TerminalEvent) => void;
  finishSession: (code: number) => void;
}

export interface SessionRuntimeHandle {
  abort(): void;
}

export interface SessionRuntimePort {
  startTake(
    agent: AgentTarget,
    context: RuntimeSessionContext,
  ): Promise<SessionRuntimeHandle>;
}
