import type { Beat } from "@/lib/types";
import type {
  UpdateBeatInput,
} from "@/lib/schemas";

export interface AgentInfo {
  agentName?: string;
  model?: string;
  version?: string;
}

export interface BeatColumnOpts {
  showRepoColumn?: boolean;
  showAgentColumns?: boolean;
  agentInfoByBeatId?: Record<string, AgentInfo>;
  onUpdateBeat?: (
    id: string,
    fields: UpdateBeatInput,
    repoPath?: string,
  ) => void;
  /**
   * Hackish fat-finger correction. When provided, the table-cell
   * state dropdown surfaces a Rewind submenu listing earlier queue
   * states; selecting one routes through `/api/beats/{id}/rewind`
   * (kno's `force: true`). Not a primary workflow action — see
   * `BackendPort.rewind`.
   */
  onRewindBeat?: (
    id: string,
    targetState: string,
    repoPath?: string,
  ) => void;
  onTitleClick?: (beat: Beat) => void;
  onShipBeat?: (beat: Beat) => void;
  shippingByBeatId?: Record<string, string>;
  onAbortShipping?: (beatId: string) => void;
  allLabels?: string[];
  onCloseBeat?: (beatId: string) => void;
  collapsedIds?: Set<string>;
  onToggleCollapse?: (id: string) => void;
  childCountMap?: Map<string, number>;
  /** Workflow states for dropdown. */
  availableStates?: string[];
  /** Beat IDs with inherited rolling state. */
  parentRollingBeatIds?: Set<string>;
}
