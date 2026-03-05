"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
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
import { Separator } from "@/components/ui/separator";
import { SettingsAgentsSection } from "@/components/settings-agents-section";
import { SettingsReposSection } from "@/components/settings-repos-section";
import { SettingsDefaultsSection } from "@/components/settings-defaults-section";
import { SettingsDispatchSection } from "@/components/settings-dispatch-section";
import { fetchSettings, saveSettings } from "@/lib/settings-api";
import { cn } from "@/lib/utils";
import type { RegisteredAgent } from "@/lib/types";
import type {
  ActionAgentMappings,
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
  agents: Record<string, RegisteredAgent>;
  actions: ActionAgentMappings;
  backend: BackendSettings;
  defaults: DefaultsSettings;
  openrouter: OpenRouterSettings;
  pools: PoolsSettings;
  dispatchMode: DispatchMode;
}

function SettingsSectionCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/20 via-background/85 to-accent/18 p-4 shadow-md backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/45 hover:shadow-lg",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/80 to-transparent" />
      <div className="pointer-events-none absolute -top-16 -right-14 h-36 w-36 rounded-full bg-primary/30 opacity-80 blur-3xl transition-opacity duration-300 group-hover:opacity-100" />
      <div className="pointer-events-none absolute -bottom-16 -left-14 h-36 w-36 rounded-full bg-accent/25 opacity-75 blur-3xl transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative">{children}</div>
    </div>
  );
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
  openrouter: {
    apiKey: "",
    enabled: false,
    agents: {},
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
            agents: settingsResult.data.agents ?? DEFAULTS.agents,
            actions: settingsResult.data.actions ?? DEFAULTS.actions,
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
      <SheetContent className="relative overflow-hidden border-primary/40 bg-gradient-to-br from-primary/14 via-background/96 to-accent/12 sm:max-w-xl">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 -right-16 h-64 w-64 rounded-full bg-primary/25 blur-3xl" />
          <div className="absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-accent/20 blur-3xl" />
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10" />
        </div>

        <div className="relative z-10 flex h-full flex-col">
          <SheetHeader>
            <SheetTitle className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Settings</SheetTitle>
            <SheetDescription>
              Configuration stored in ~/.config/foolery/settings.toml
            </SheetDescription>
          </SheetHeader>

          <div className="px-4 pt-2 flex-1 min-h-0 overflow-y-auto">
            <div className="space-y-3 py-4">
              {/* Section: Repositories (independent data, always rendered) */}
              <SettingsSectionCard
                className="border-accent/40 from-accent/18 via-background/88 to-primary/16"
              >
                <div ref={reposSectionRef}>
                  <SettingsReposSection />
                </div>
              </SettingsSectionCard>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading settings...</p>
              ) : (
                <>
                  {/* Section 1: Agent Management */}
                  <SettingsSectionCard
                    className="border-primary/40 from-primary/20 via-background/88 to-accent/14"
                  >
                    <SettingsAgentsSection
                      agents={settings.agents}
                      onAgentsChange={(agents) =>
                        setSettings((prev) => ({ ...prev, agents }))
                      }
                      openrouter={settings.openrouter}
                      onOpenRouterChange={(openrouter) =>
                        setSettings((prev) => ({ ...prev, openrouter }))
                      }
                    />
                  </SettingsSectionCard>

                  {/* Section 2: Agent Dispatch (Actions + Pools with mode toggle) */}
                  <SettingsSectionCard
                    className="border-primary/35 from-primary/18 via-background/88 to-accent/18"
                  >
                    <SettingsDispatchSection
                      dispatchMode={settings.dispatchMode}
                      actions={settings.actions}
                      pools={settings.pools}
                      agents={settings.agents}
                      openrouter={settings.openrouter}
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
                  </SettingsSectionCard>

                  {/* Section 4: Defaults */}
                  <SettingsSectionCard
                    className="border-accent/35 from-accent/18 via-background/88 to-primary/14"
                  >
                    <SettingsDefaultsSection
                      defaults={settings.defaults}
                      onDefaultsChange={(defaults) =>
                        setSettings((prev) => ({ ...prev, defaults }))
                      }
                    />
                  </SettingsSectionCard>
                </>
              )}
            </div>
          </div>

          <Separator className="bg-gradient-to-r from-transparent via-primary/55 to-transparent" />
          <SheetFooter className="bg-gradient-to-r from-primary/10 via-background/88 to-accent/10 px-4 py-3">
            <Button
              variant="outline"
              className="border-primary/45 bg-background/85 hover:border-accent/45 hover:bg-accent/15"
              onClick={handleReset}
              disabled={saving}
            >
              Reset to Defaults
            </Button>
            <Button
              className="bg-gradient-to-r from-primary via-primary to-accent text-primary-foreground shadow-md hover:opacity-95"
              onClick={handleSave}
              disabled={saving || loading}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}
