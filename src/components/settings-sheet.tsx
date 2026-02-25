"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsAgentsSection } from "@/components/settings-agents-section";
import { SettingsActionsSection } from "@/components/settings-actions-section";
import { SettingsReposSection } from "@/components/settings-repos-section";
import { SettingsVerificationSection } from "@/components/settings-verification-section";
import { fetchSettings, saveSettings } from "@/lib/settings-api";
import { fetchRegistry } from "@/lib/registry-api";
import { fetchWorkflows } from "@/lib/api";
import type { RegisteredAgent } from "@/lib/types";
import type {
  ActionAgentMappings,
  VerificationSettings,
  BackendSettings,
  WorkflowSettings,
} from "@/lib/schemas";
import type {
  CoarsePrPreference,
  MemoryWorkflowDescriptor,
  RegisteredRepo,
} from "@/lib/types";

export type SettingsSection = "repos" | null;

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: SettingsSection;
}

interface SettingsData {
  agent: { command: string };
  agents: Record<string, RegisteredAgent>;
  actions: ActionAgentMappings;
  verification: VerificationSettings;
  backend: BackendSettings;
  workflow: WorkflowSettings;
}

const DEFAULTS: SettingsData = {
  agent: { command: "claude" },
  agents: {},
  actions: {
    take: "",
    scene: "",
    direct: "",
    breakdown: "",
  },
  verification: {
    enabled: false,
    agent: "",
    maxRetries: 3,
  },
  backend: {
    type: "auto",
  },
  workflow: {
    coarsePrPreferenceOverrides: {},
  },
};

export function SettingsSheet({ open, onOpenChange, initialSection }: SettingsSheetProps) {
  const [settings, setSettings] = useState<SettingsData>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [repos, setRepos] = useState<RegisteredRepo[]>([]);
  const [selectedPolicyRepoPath, setSelectedPolicyRepoPath] = useState("");
  const [workflows, setWorkflows] = useState<MemoryWorkflowDescriptor[]>([]);
  const [loadingWorkflows, setLoadingWorkflows] = useState(false);
  const reposSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && initialSection === "repos" && reposSectionRef.current) {
      reposSectionRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [open, initialSection, loading]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([fetchSettings(), fetchRegistry()])
      .then(([settingsResult, registryResult]) => {
        if (settingsResult.ok && settingsResult.data) {
          setSettings({
            agent: settingsResult.data.agent ?? DEFAULTS.agent,
            agents: settingsResult.data.agents ?? DEFAULTS.agents,
            actions: settingsResult.data.actions ?? DEFAULTS.actions,
            verification: settingsResult.data.verification ?? DEFAULTS.verification,
            backend: settingsResult.data.backend ?? DEFAULTS.backend,
            workflow: settingsResult.data.workflow ?? DEFAULTS.workflow,
          });
        }
        if (registryResult.ok) {
          const registryRepos = registryResult.data ?? [];
          setRepos(registryRepos);
          setSelectedPolicyRepoPath((prev) =>
            prev || registryRepos[0]?.path || ""
          );
        }
      })
      .catch(() => toast.error("Failed to load settings"))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!selectedPolicyRepoPath) {
      setWorkflows([]);
      return;
    }
    setLoadingWorkflows(true);
    fetchWorkflows(selectedPolicyRepoPath)
      .then((result) => {
        if (result.ok && result.data) {
          setWorkflows(result.data);
        } else {
          setWorkflows([]);
        }
      })
      .catch(() => setWorkflows([]))
      .finally(() => setLoadingWorkflows(false));
  }, [open, selectedPolicyRepoPath]);

  const coarseWorkflows = useMemo(
    () => workflows.filter((workflow) => workflow.mode === "coarse_human_gated"),
    [workflows],
  );
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");

  useEffect(() => {
    if (coarseWorkflows.length === 0) {
      setSelectedWorkflowId("");
      return;
    }
    if (!coarseWorkflows.some((workflow) => workflow.id === selectedWorkflowId)) {
      setSelectedWorkflowId(coarseWorkflows[0]?.id ?? "");
    }
  }, [coarseWorkflows, selectedWorkflowId]);

  const selectedWorkflow = coarseWorkflows.find((workflow) => workflow.id === selectedWorkflowId);
  const selectedOverrideKey = selectedPolicyRepoPath && selectedWorkflowId
    ? `${selectedPolicyRepoPath}::${selectedWorkflowId}`
    : "";
  const defaultPolicy: CoarsePrPreference =
    selectedWorkflow?.coarsePrPreferenceDefault ?? "soft_required";
  const effectivePolicy: CoarsePrPreference = selectedOverrideKey
    ? settings.workflow.coarsePrPreferenceOverrides[selectedOverrideKey] ?? defaultPolicy
    : defaultPolicy;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await saveSettings(settings);
      if (res.ok) {
        toast.success("Settings saved");
        if (res.data) setSettings(res.data);
      } else {
        toast.error(res.error ?? "Failed to save settings");
      }
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setSettings(DEFAULTS);
  }

  function updateCoarsePolicy(policy: CoarsePrPreference) {
    if (!selectedOverrideKey) return;
    setSettings((prev) => {
      const next = { ...prev.workflow.coarsePrPreferenceOverrides };
      if (policy === defaultPolicy) {
        delete next[selectedOverrideKey];
      } else {
        next[selectedOverrideKey] = policy;
      }
      return {
        ...prev,
        workflow: {
          ...prev.workflow,
          coarsePrPreferenceOverrides: next,
        },
      };
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            Configuration stored in ~/.config/foolery/settings.toml
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 px-4 py-6 overflow-y-auto flex-1">
          {/* Section: Repositories (independent data, always rendered) */}
          <div ref={reposSectionRef}>
            <SettingsReposSection />
          </div>

          <Separator />
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading settings...</p>
          ) : (
            <>
              {/* Section 1: Agent Management */}
              <SettingsAgentsSection
                agents={settings.agents}
                onAgentsChange={(agents) =>
                  setSettings((prev) => ({ ...prev, agents }))
                }
              />

              <Separator />

              {/* Section 2: Action Mappings */}
              <SettingsActionsSection
                actions={settings.actions}
                agents={settings.agents}
                onActionsChange={(actions) =>
                  setSettings((prev) => ({ ...prev, actions }))
                }
              />

              <Separator />

              {/* Section 3: Auto-Verification */}
              <SettingsVerificationSection
                verification={settings.verification}
                agents={settings.agents}
                onVerificationChange={(verification) =>
                  setSettings((prev) => ({ ...prev, verification }))
                }
              />

              <Separator />

              {/* Section 4: Workflow PR policy */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Verification PR Policy</h3>
                {repos.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Add a repository to configure coarse workflow PR preferences.
                  </p>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="workflow-policy-repo">Repository</Label>
                      <Select
                        value={selectedPolicyRepoPath || "__none__"}
                        onValueChange={(value) =>
                          setSelectedPolicyRepoPath(value === "__none__" ? "" : value)
                        }
                      >
                        <SelectTrigger id="workflow-policy-repo" className="w-full">
                          <SelectValue placeholder="Select repository" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Select repository</SelectItem>
                          {repos.map((repo) => (
                            <SelectItem key={repo.path} value={repo.path}>
                              {repo.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="workflow-policy-workflow">Coarse Workflow</Label>
                      <Select
                        value={selectedWorkflowId || "__none__"}
                        onValueChange={(value) =>
                          setSelectedWorkflowId(value === "__none__" ? "" : value)
                        }
                        disabled={!selectedPolicyRepoPath || loadingWorkflows}
                      >
                        <SelectTrigger id="workflow-policy-workflow" className="w-full">
                          <SelectValue
                            placeholder={
                              loadingWorkflows ? "Loading workflows..." : "Select workflow"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Select workflow</SelectItem>
                          {coarseWorkflows.map((workflow) => (
                            <SelectItem key={workflow.id} value={workflow.id}>
                              {workflow.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="workflow-policy-value">PR Preference</Label>
                      <Select
                        value={effectivePolicy}
                        onValueChange={(value) =>
                          updateCoarsePolicy(value as CoarsePrPreference)
                        }
                        disabled={!selectedOverrideKey}
                      >
                        <SelectTrigger id="workflow-policy-value" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="soft_required">Soft required</SelectItem>
                          <SelectItem value="preferred">Preferred</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Defaults to <span className="font-mono">{defaultPolicy}</span>. Picking
                        the default removes the override.
                      </p>
                    </div>
                  </>
                )}
              </div>

              <Separator />

              {/* Section 5: Legacy / Default Agent */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Default Agent Command</h3>
                <div className="space-y-2">
                  <Label htmlFor="agent-command">Command</Label>
                  <Input
                    id="agent-command"
                    value={settings.agent.command}
                    placeholder="claude"
                    disabled={Object.keys(settings.agents).length > 0}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        agent: { ...prev.agent, command: e.target.value },
                      }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {Object.keys(settings.agents).length > 0
                      ? "Disabled — actions use registered agents above. Remove all agents to edit."
                      : "Fallback command when no agent is mapped to an action."}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        <SheetFooter className="px-4">
          <Button variant="outline" onClick={handleReset} disabled={saving}>
            Reset to Defaults
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
