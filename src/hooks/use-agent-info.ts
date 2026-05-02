"use client";

import { useEffect, useState } from "react";
import { fetchSettings } from "@/lib/settings-api";
import type { ActionName } from "@/lib/types";
import {
  detectAgentProviderId,
  formatAgentDisplayLabel,
} from "@/lib/agent-identity";

export interface ResolvedAgentInfo {
  /** Display name, e.g. "Claude", "Codex", "Gemini" */
  name: string;
  /** Model identifier if configured, e.g. "sonnet" */
  model?: string;
  flavor?: string;
  /** Agent version if configured, e.g. "4.5" */
  version?: string;
  /** CLI command path, e.g. "claude" */
  command: string;
  /** Vendor key used for icon selection */
  vendor: string;
}
export const detectVendor = detectAgentProviderId;

/**
 * Hook that fetches settings and resolves agent info for a given action.
 * Returns null while loading.
 */
export function useAgentInfo(action: ActionName): ResolvedAgentInfo | null {
  const [info, setInfo] = useState<ResolvedAgentInfo | null>(null);

  useEffect(() => {
    let cancelled = false;

    void fetchSettings().then((result) => {
      if (cancelled || !result.ok || !result.data) return;
      const settings = result.data;
      const agentId = settings.actions[action] ?? "";
      const registered =
        agentId && agentId !== "default" ? settings.agents[agentId] : null;

      if (registered) {
        const command = registered.command;
        const vendor = detectVendor(command);
        setInfo({
          name: formatAgentDisplayLabel(registered),
          model: registered.model,
          flavor: registered.flavor,
          version: registered.version,
          command,
          vendor,
        });
      } else {
        const first = Object.values(settings.agents)[0];
        const command = first?.command ?? "claude";
        const vendor = detectVendor(command);
        setInfo({
          name: formatAgentDisplayLabel(first ?? { command }),
          model: first?.model,
          flavor: first?.flavor,
          version: first?.version,
          command,
          vendor,
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [action]);

  return info;
}
