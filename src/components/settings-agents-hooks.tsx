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
  toCanonicalLeaseIdentity,
} from "@/lib/agent-identity";
import { canonicalizeRuntimeModel } from "@/lib/agent-config-normalization";
import {
  addAgent,
  scanAgents,
  saveActions,
} from "@/lib/settings-api";
import type {
  ActionAgentMappings,
  PoolsSettings,
} from "@/lib/schemas";
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
  return saveActions(mappings);
}

function buildAgentPayload(
  scanned: ScannedAgent,
  selected: ScannedAgentOption,
) {
  const runtimeModel = canonicalizeRuntimeModel(
    scanned.command,
    selected.modelId ?? selected.model,
  );
  const canonical = toCanonicalLeaseIdentity({
    command: scanned.path,
    provider: selected.provider,
    flavor: selected.flavor,
    version: selected.version,
    ...(runtimeModel ? { model: runtimeModel } : {}),
  });

  return {
    command: scanned.path,
    ...(canonical.agent_type
      ? { agent_type: canonical.agent_type }
      : {}),
    ...(canonical.vendor ? { vendor: canonical.vendor } : {}),
    ...(canonical.provider
      ? { provider: canonical.provider }
      : {}),
    ...(canonical.agent_name
      ? { agent_name: canonical.agent_name }
      : {}),
    ...(canonical.lease_model
      ? { lease_model: canonical.lease_model }
      : {}),
    ...(runtimeModel ? { model: runtimeModel } : {}),
    ...(canonical.version
      ? { version: canonical.version }
      : {}),
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
  onSettingsChange: (next: {
    agents: Record<string, RegisteredAgent>;
    actions?: ActionAgentMappings;
    pools?: PoolsSettings;
  }) => void,
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
        const nextPatch: {
          agents: Record<string, RegisteredAgent>;
          actions?: ActionAgentMappings;
        } = {
          agents: res.data,
        };
        if (Object.keys(res.data).length === 1) {
          const actionsRes =
            await setDefaultAgentForActions(option.id);
          if (actionsRes.ok && actionsRes.data) {
            nextPatch.actions = actionsRes.data;
          } else {
            toast.error(
              actionsRes.error
                ?? "Failed to save default action mappings",
            );
          }
        }
        onSettingsChange(nextPatch);
        toast.success(
          `Added ${option.label}`,
        );
      } else {
        toast.error(
          res.error ?? "Failed to add agent",
        );
      }
    },
    [onSettingsChange],
  );

  return {
    handleAddScannedOption,
  };
}

/**
 * Legacy helper kept for backward compatibility.
 * Used by callers that still reference the old
 * single-select flow.
 */
export { resolveSelectedOption };
