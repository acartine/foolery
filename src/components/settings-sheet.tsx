"use client";

import { useEffect, useRef, useState } from "react";
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
import { SettingsAgentsSection } from "@/components/settings-agents-section";
import { SettingsReposSection } from "@/components/settings-repos-section";
import { SettingsVerificationSection } from "@/components/settings-verification-section";
import { SettingsDefaultsSection } from "@/components/settings-defaults-section";
import { SettingsOpenRouterSection } from "@/components/settings-openrouter-section";
import { SettingsDispatchSection } from "@/components/settings-dispatch-section";
import { fetchSettings, saveSettings } from "@/lib/settings-api";
import type { RegisteredAgent } from "@/lib/types";
import type {
  ActionAgentMappings,
  VerificationSettings,
  BackendSettings,
  DefaultsSettings,
  OpenRouterSettings,
  PoolsSettings,
  DispatchMode,
} from "@/lib/schemas";

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
  defaults: DefaultsSettings;
  openrouter: OpenRouterSettings;
  pools: PoolsSettings;
  dispatchMode: DispatchMode;
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
  defaults: {
    profileId: "",
  },
  openrouter: {
    apiKey: "",
    enabled: false,
    model: "",
  },
  pools: {
    planning: [],
    plan_review: [],
    implementation: [],
    implementation_review: [],
    shipment: [],
    shipment_review: [],
  },
  dispatchMode: "actions",
};

export function SettingsSheet({ open, onOpenChange, initialSection }: SettingsSheetProps) {
  const [settings, setSettings] = useState<SettingsData>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const reposSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && initialSection === "repos" && reposSectionRef.current) {
      reposSectionRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [open, initialSection, loading]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchSettings()
      .then((settingsResult) => {
        if (settingsResult.ok && settingsResult.data) {
          setSettings({
            agent: settingsResult.data.agent ?? DEFAULTS.agent,
            agents: settingsResult.data.agents ?? DEFAULTS.agents,
            actions: settingsResult.data.actions ?? DEFAULTS.actions,
            verification: settingsResult.data.verification ?? DEFAULTS.verification,
            backend: settingsResult.data.backend ?? DEFAULTS.backend,
            defaults: settingsResult.data.defaults ?? DEFAULTS.defaults,
            openrouter: settingsResult.data.openrouter ?? DEFAULTS.openrouter,
            pools: settingsResult.data.pools ?? DEFAULTS.pools,
            dispatchMode: settingsResult.data.dispatchMode ?? DEFAULTS.dispatchMode,
          });
        }
      })
      .catch(() => toast.error("Failed to load settings"))
      .finally(() => setLoading(false));
  }, [open]);

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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            Configuration stored in ~/.config/foolery/settings.toml
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pt-2 flex-1 min-h-0 overflow-y-auto">
          <div className="space-y-3 py-4">
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

                {/* Section 2: Agent Dispatch (Actions + Pools with mode toggle) */}
                <SettingsDispatchSection
                  dispatchMode={settings.dispatchMode}
                  actions={settings.actions}
                  pools={settings.pools}
                  agents={settings.agents}
                  onDispatchModeChange={(dispatchMode) =>
                    setSettings((prev) => ({ ...prev, dispatchMode }))
                  }
                  onActionsChange={(actions) =>
                    setSettings((prev) => ({ ...prev, actions }))
                  }
                  onPoolsChange={(pools) =>
                    setSettings((prev) => ({ ...prev, pools }))
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

                {/* Section 4: Defaults */}
                <SettingsDefaultsSection
                  defaults={settings.defaults}
                  onDefaultsChange={(defaults) =>
                    setSettings((prev) => ({ ...prev, defaults }))
                  }
                />

                <Separator />

                {/* Section 5: OpenRouter */}
                <SettingsOpenRouterSection
                  openrouter={settings.openrouter}
                  onOpenRouterChange={(openrouter) =>
                    setSettings((prev) => ({ ...prev, openrouter }))
                  }
                />

                <Separator />

                {/* Section 6: Legacy / Default Agent */}
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
