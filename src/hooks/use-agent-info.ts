"use client";

import { useEffect, useState } from "react";
import { fetchSettings } from "@/lib/settings-api";
import type { ActionName } from "@/lib/types";

export interface ResolvedAgentInfo {
  /** Display name, e.g. "claude", "codex", "gemini" */
  name: string;
  /** Model identifier if configured, e.g. "opus-4" */
  model?: string;
  /** CLI command path, e.g. "claude" */
  command: string;
  /** Vendor key used for icon selection */
  vendor: string;
}

/**
 * Detect vendor from command string.
 * Matches "claude", "codex", or "gemini" anywhere in the command.
 */
export function detectVendor(command: string): string {
  const lower = command.toLowerCase();
  if (lower.includes("claude")) return "claude";
  if (lower.includes("codex")) return "codex";
  if (lower.includes("gemini")) return "gemini";
  return "unknown";
}

/**
 * Hook that fetches settings and resolves agent info for a given action.
 * Returns null while loading.
 */
export function useAgentInfo(action: ActionName): ResolvedAgentInfo | null {
  const [info, setInfo] = useState<ResolvedAgentInfo | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchSettings().then((result) => {
      if (cancelled || !result.ok || !result.data) return;
      const settings = result.data;
      const agentId = settings.actions[action] ?? "";
      const registered =
        agentId && agentId !== "default" ? settings.agents[agentId] : null;

      if (registered) {
        const command = registered.command;
        const vendor = detectVendor(command);
        setInfo({
          name: registered.label || agentId,
          model: registered.model,
          command,
          vendor,
        });
      } else {
        const command = settings.agent.command;
        const vendor = detectVendor(command);
        setInfo({
          name: command,
          model: undefined,
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
