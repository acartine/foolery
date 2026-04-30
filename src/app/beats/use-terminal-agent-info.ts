/**
 * useTerminalAgentInfo — resolve canonical agent identity for an active
 * terminal from the bound Knots lease.
 *
 * The terminal store carries only `knotsLeaseId`; this hook joins that with
 * the latest `TerminalSession` snapshot returned by `/api/terminal` (which
 * carries `knotsAgentInfo` mirrored from the lease's autostamp-derived
 * `agent_info` server-side).
 *
 * See `docs/knots-agent-identity-contract.md` rule 5.
 */
import { useQuery } from "@tanstack/react-query";
import type { ActiveTerminal } from "@/stores/terminal-store";
import { listSessions } from "@/lib/terminal-api";
import type {
  TerminalSession,
  TerminalSessionAgentInfo,
} from "@/lib/types";

const TERMINAL_SESSIONS_QUERY_KEY = ["terminal-sessions"] as const;
const REFETCH_INTERVAL_MS = 5_000;

/**
 * Returns a map keyed by `sessionId -> TerminalSessionAgentInfo` (canonical
 * agent identity from the bound lease).  Empty map until the first fetch
 * resolves.
 */
export function useTerminalAgentInfoMap(): Map<
  string,
  TerminalSessionAgentInfo
> {
  const { data } = useQuery({
    queryKey: TERMINAL_SESSIONS_QUERY_KEY,
    queryFn: () => listSessions(),
    refetchInterval: REFETCH_INTERVAL_MS,
    staleTime: REFETCH_INTERVAL_MS,
  });
  return buildAgentInfoMap(data ?? []);
}

/**
 * Pure helper: map an array of `TerminalSession` to a sessionId-keyed
 * `Map<string, TerminalSessionAgentInfo>`.  Sessions without
 * `knotsAgentInfo` are skipped — `docs/knots-agent-identity-contract.md`
 * forbids fabricating identity from non-lease sources.
 */
export function buildAgentInfoMap(
  sessions: TerminalSession[],
): Map<string, TerminalSessionAgentInfo> {
  const map = new Map<string, TerminalSessionAgentInfo>();
  for (const session of sessions) {
    if (session.knotsAgentInfo) {
      map.set(session.id, session.knotsAgentInfo);
    }
  }
  return map;
}

/**
 * Resolve a single terminal's canonical agent identity, or `undefined` if
 * the lease hasn't been bound yet (in-flight) or the agent info isn't yet
 * available in the latest fetched snapshot.
 */
export function lookupTerminalAgentInfo(
  terminal: Pick<ActiveTerminal, "sessionId">,
  agentInfoMap: Map<string, TerminalSessionAgentInfo>,
): TerminalSessionAgentInfo | undefined {
  return agentInfoMap.get(terminal.sessionId);
}
