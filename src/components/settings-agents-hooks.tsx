"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import type {
  RegisteredAgent,
  ScannedAgent,
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
  selected: NonNullable<
    ReturnType<typeof resolveSelectedOption>
  >,
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
  const [
    selectedScannedOptions,
    setSelectedScannedOptions,
  ] = useState<Record<string, string>>({});

  const handleScan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await scanAgents();
      if (res.ok && res.data) {
        setScannedAgents(res.data);
        setSelectedScannedOptions(
          Object.fromEntries(
            res.data.map((agent) => [
              agent.id,
              agent.selectedOptionId
                ?? agent.options?.[0]?.id
                ?? "",
            ]),
          ),
        );
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
    selectedScannedOptions,
    setSelectedScannedOptions,
    handleScan,
    dismissScan,
  };
}

async function addAllAgents(
  unregistered: ScannedAgent[],
  opts: Record<string, string>,
  onChange: (
    agents: Record<string, RegisteredAgent>,
  ) => void,
) {
  const sorted = [...unregistered].sort(
    (a, b) => a.id.localeCompare(b.id),
  );
  let latestAgents:
    | Record<string, RegisteredAgent>
    | undefined;
  let firstAddedId: string | null = null;
  for (const agent of sorted) {
    const selected = resolveSelectedOption(
      agent,
      opts,
    );
    if (!selected) continue;
    const res = await addAgent(
      selected.id,
      buildAgentPayload(agent, selected),
    );
    if (res.ok && res.data) {
      latestAgents = res.data;
      firstAddedId ??= selected.id;
    } else {
      toast.error(
        res.error
          ?? `Failed to add ${agent.id}`,
      );
      return;
    }
  }
  if (latestAgents) {
    onChange(latestAgents);
    if (firstAddedId) {
      await setDefaultAgentForActions(
        firstAddedId,
      );
    }
    toast.success(
      `Added ${sorted.length} agent(s)`,
    );
  }
}

export function useAgentMutations(
  onAgentsChange: (
    agents: Record<string, RegisteredAgent>,
  ) => void,
  selectedScannedOptions: Record<string, string>,
) {
  const handleAddScanned = useCallback(
    async (scanned: ScannedAgent) => {
      const selected = resolveSelectedOption(
        scanned,
        selectedScannedOptions,
      );
      if (!selected) {
        toast.error(
          "No import option for " + scanned.id,
        );
        return;
      }
      const res = await addAgent(
        selected.id,
        buildAgentPayload(scanned, selected),
      );
      if (res.ok && res.data) {
        onAgentsChange(res.data);
        if (Object.keys(res.data).length === 1) {
          await setDefaultAgentForActions(
            selected.id,
          );
        }
        toast.success(
          `Added ${selected.label}`,
        );
      } else {
        toast.error(
          res.error ?? "Failed to add agent",
        );
      }
    },
    [onAgentsChange, selectedScannedOptions],
  );

  const handleAddAll = useCallback(
    (unregistered: ScannedAgent[]) =>
      addAllAgents(
        unregistered,
        selectedScannedOptions,
        onAgentsChange,
      ),
    [onAgentsChange, selectedScannedOptions],
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

  return {
    handleAddScanned,
    handleAddAll,
    handleRemove,
  };
}
