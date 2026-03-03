"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { sessionConnections } from "@/lib/session-connection-manager";

/**
 * Thin client component that initializes the SessionConnectionManager on mount.
 * Renders nothing — just wires up the SSE sync lifecycle.
 */
export function TerminalConnectionSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    sessionConnections.startSync(queryClient);
    return () => {
      sessionConnections.stopSync();
    };
  }, [queryClient]);

  return null;
}
