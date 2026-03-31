"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import type {
  RegisteredAgent,
  ScannedAgent,
  ScannedAgentOption,
} from "@/lib/types";
import {
  formatAgentOptionLabel,
} from "@/lib/agent-identity";
import {
  addAgent,
  removeAgent,
  scanAgents,
  saveActions,
} from "@/lib/settings-api";
import type { ActionAgentMappings } from "@/lib/schemas";
import {
  resolveSelectedOption,
} from "@/components/settings-agents-scanned";

async function setDefaultAgentForActions(
  agentId: string,
) {
  const mappings: ActionAgentMappings = {
    take: agentId,
    scene: agentId,
    breakdown: agentId,
    scopeRefinement: agentId,
  };
  await saveActions(mappings);
}

function buildAgentPayload(
  scanned: ScannedAgent,
  selected: ScannedAgentOption,
) {
  return {
    command: scanned.path,
    provider: selected.provider,
    model: selected.modelId ?? selected.model,
    flavor: selected.flavor,
    version: selected.version,
    label: formatAgentOptionLabel(selected),
  };
}

export function useAgentScanner() {
  const [scanning, setScanning] = useState(false);
  const [scannedAgents, setScannedAgents] =
    useState<ScannedAgent[] | null>(null);

  const handleScan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await scanAgents();
      if (res.ok && res.data) {
        setScannedAgents(res.data);
        const installed = res.data.filter(
          (a) => a.installed,
        );
        if (installed.length === 0) {
          toast.info(
            "No agent CLIs found on PATH",
          );
        } else {
          toast.success(
            `Found ${installed.length} agent CLI(s)`,
          );
        }
      } else {
        toast.error(res.error ?? "Scan failed");
      }
    } catch {
      toast.error("Failed to scan for agents");
    } finally {
      setScanning(false);
    }
  }, []);

  const dismissScan = useCallback(() => {
    setScannedAgents(null);
  }, []);

  return {
    scanning,
    scannedAgents,
    handleScan,
    dismissScan,
  };
}

export function useAgentMutations(
  onAgentsChange: (
    agents: Record<string, RegisteredAgent>,
  ) => void,
) {
  const handleAddScannedOption = useCallback(
    async (
      scanned: ScannedAgent,
      option: ScannedAgentOption,
    ) => {
      const res = await addAgent(
        option.id,
        buildAgentPayload(scanned, option),
      );
      if (res.ok && res.data) {
        onAgentsChange(res.data);
        if (Object.keys(res.data).length === 1) {
          await setDefaultAgentForActions(
            option.id,
          );
        }
        toast.success(
          `Added ${option.label}`,
        );
      } else {
        toast.error(
          res.error ?? "Failed to add agent",
        );
      }
    },
    [onAgentsChange],
  );

  const handleRemove = useCallback(
    async (id: string) => {
      const res = await removeAgent(id);
      if (res.ok && res.data) {
        onAgentsChange(res.data);
        toast.success(`Removed ${id}`);
      } else {
        toast.error(
          res.error
            ?? "Failed to remove agent",
        );
      }
    },
    [onAgentsChange],
  );

  const handleRemoveScannedOption = useCallback(
    async (
      id: string,
      optionLabel?: string,
    ) => {
      const res = await removeAgent(id);
      if (res.ok && res.data) {
        onAgentsChange(res.data);
        toast.success(
          optionLabel
            ? `Cleared ${optionLabel}`
            : `Removed ${id}`,
        );
      } else {
        toast.error(
          res.error
            ?? "Failed to remove agent",
        );
      }
    },
    [onAgentsChange],
  );

  return {
    handleAddScannedOption,
    handleRemoveScannedOption,
    handleRemove,
  };
}

/**
 * Legacy helper kept for backward compatibility.
 * Used by callers that still reference the old
 * single-select flow.
 */
export { resolveSelectedOption };
