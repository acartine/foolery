"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FolderKanban, Bot, GitBranchPlus, Settings2 } from "lucide-react";
import { SettingsAgentsSection } from "@/components/settings-agents-section";
import { SettingsReposSection } from "@/components/settings-repos-section";
import { SettingsDefaultsSection } from "@/components/settings-defaults-section";
import { SettingsDispatchSection } from "@/components/settings-dispatch-section";
import { fetchSettings, saveSettings } from "@/lib/settings-api";
import type { RegisteredAgent } from "@/lib/types";
import type {
  ActionAgentMappings,
  BackendSettings,
  DefaultsSettings,
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
  agents: Record<string, RegisteredAgent>;
  actions: ActionAgentMappings;
  backend: BackendSettings;
  defaults: DefaultsSettings;
  pools: PoolsSettings;
  dispatchMode: DispatchMode;
  maxConcurrentSessions: number;
}

const DEFAULTS: SettingsData = {
  agents: {},
  actions: {
    take: "",
    scene: "",
    breakdown: "",
  },
  backend: {
    type: "auto",
  },
  defaults: {
    profileId: "",
  },
  pools: {
    planning: [],
    plan_review: [],
    implementation: [],
    implementation_review: [],
    shipment: [],
    shipment_review: [],
  },
  dispatchMode: "basic",
  maxConcurrentSessions: 5,
};

type SettingsTab = "repos" | "agents" | "dispatch" | "defaults";

const TAB_DEFS: { value: SettingsTab; label: string; icon: typeof Bot }[] = [
  { value: "repos", label: "Repos", icon: FolderKanban },
  { value: "agents", label: "Agents", icon: Bot },
  { value: "dispatch", label: "Dispatch", icon: GitBranchPlus },
  { value: "defaults", label: "Defaults", icon: Settings2 },
];

export function SettingsSheet({ open, onOpenChange, initialSection }: SettingsSheetProps) {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<SettingsData>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("repos");

  useEffect(() => {
    if (open && initialSection === "repos") {
      setActiveTab("repos");
    }
  }, [open, initialSection]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchSettings()
      .then((settingsResult) => {
        if (settingsResult.ok && settingsResult.data) {
          setSettings({
            agents: settingsResult.data.agents ?? DEFAULTS.agents,
            actions: settingsResult.data.actions ?? DEFAULTS.actions,
            backend: settingsResult.data.backend ?? DEFAULTS.backend,
            defaults: settingsResult.data.defaults ?? DEFAULTS.defaults,
            pools: settingsResult.data.pools ?? DEFAULTS.pools,
            dispatchMode: settingsResult.data.dispatchMode ?? DEFAULTS.dispatchMode,
            maxConcurrentSessions: settingsResult.data.maxConcurrentSessions ?? DEFAULTS.maxConcurrentSessions,
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
        queryClient.invalidateQueries({ queryKey: ["settings"] });
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
      <SheetContent className="overflow-hidden border-primary/20 bg-background sm:max-w-xl">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as SettingsTab)}
          className="flex flex-col h-full"
        >
          <div className="px-4 pt-2 shrink-0">
            <TabsList className="w-full">
              {TAB_DEFS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="gap-1.5 text-xs"
                  >
                    <Icon className="size-3.5" />
                    {tab.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          <div className="px-4 flex-1 min-h-0 overflow-y-auto">
            <div className="py-3">
              {loading ? (
                <p className="text-xs text-muted-foreground">Loading settings...</p>
              ) : (
                <>
                  <TabsContent value="repos">
                    <SettingsReposSection />
                  </TabsContent>

                  <TabsContent value="agents">
                    <SettingsAgentsSection
                      agents={settings.agents}
                      onAgentsChange={(agents) =>
                        setSettings((prev) => ({ ...prev, agents }))
                      }
                    />
                  </TabsContent>

                  <TabsContent value="dispatch">
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
                  </TabsContent>

                  <TabsContent value="defaults">
                    <SettingsDefaultsSection
                      defaults={settings.defaults}
                      onDefaultsChange={(defaults) =>
                        setSettings((prev) => ({ ...prev, defaults }))
                      }
                      maxConcurrentSessions={settings.maxConcurrentSessions}
                      onMaxConcurrentSessionsChange={(maxConcurrentSessions) =>
                        setSettings((prev) => ({ ...prev, maxConcurrentSessions }))
                      }
                    />
                  </TabsContent>
                </>
              )}
            </div>
          </div>
        </Tabs>

        <Separator className="bg-gradient-to-r from-transparent via-primary/35 to-transparent" />
        <SheetFooter className="px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            className="border-primary/25 bg-background/70 hover:border-accent/35 hover:bg-accent/10"
            onClick={handleReset}
            disabled={saving}
          >
            Reset to Defaults
          </Button>
          <Button
            size="sm"
            className="bg-primary text-primary-foreground shadow-[0_12px_30px_-18px_rgba(88,28,135,0.55)] hover:bg-primary/90"
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
