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
        "group relative overflow-hidden rounded-2xl border border-primary/65 bg-gradient-to-br from-primary/44 via-primary/14 to-accent/38 p-4 shadow-lg shadow-primary/15 ring-1 ring-primary/32 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/75 hover:ring-accent/45 hover:shadow-xl hover:shadow-accent/20",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/22 via-primary/8 to-accent/18" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(147,51,234,0.17),transparent_35%,rgba(34,197,94,0.14)_70%,transparent)] opacity-80" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-accent/85" />
      <div className="pointer-events-none absolute inset-y-2 left-0 w-px bg-gradient-to-b from-transparent via-accent/85 to-transparent" />
      <div className="pointer-events-none absolute -top-16 -right-14 h-44 w-44 rounded-full bg-primary/44 opacity-90 blur-3xl transition-opacity duration-300 group-hover:opacity-100" />
      <div className="pointer-events-none absolute -bottom-16 -left-14 h-44 w-44 rounded-full bg-accent/38 opacity-90 blur-3xl transition-opacity duration-300 group-hover:opacity-100" />
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
      <SheetContent className="relative overflow-hidden border-primary/70 bg-gradient-to-br from-primary/38 via-background/82 to-accent/36 shadow-2xl shadow-primary/20 sm:max-w-xl">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 -right-16 h-72 w-72 rounded-full bg-primary/42 blur-3xl" />
          <div className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-accent/36 blur-3xl" />
          <div className="absolute top-20 left-24 h-56 w-56 rounded-full bg-primary/24 blur-3xl" />
          <div className="absolute bottom-16 right-24 h-52 w-52 rounded-full bg-accent/22 blur-3xl" />
          <div className="absolute inset-0 bg-gradient-to-br from-primary/24 via-primary/6 to-accent/24" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(142,82,255,0.24),transparent_45%),radial-gradient(circle_at_80%_90%,rgba(34,197,94,0.2),transparent_45%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(140deg,transparent_0%,rgba(255,255,255,0.09)_48%,transparent_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(35deg,rgba(168,85,247,0.18),transparent_40%,rgba(34,197,94,0.18)_75%,transparent)]" />
        </div>

        <div className="relative z-10 flex h-full flex-col">
          <SheetHeader>
            <SheetTitle className="bg-gradient-to-r from-primary via-primary to-accent bg-clip-text text-transparent">
              Settings
            </SheetTitle>
            <SheetDescription className="text-primary/90">
              Configuration stored in ~/.config/foolery/settings.toml
            </SheetDescription>
          </SheetHeader>

          <div className="px-4 pt-2 flex-1 min-h-0 overflow-y-auto">
            <div className="space-y-3 py-4">
              {/* Section: Repositories (independent data, always rendered) */}
              <SettingsSectionCard
                className="border-accent/62 from-accent/34 via-accent/14 to-primary/22 ring-accent/28"
              >
                <div ref={reposSectionRef}>
                  <SettingsReposSection />
                </div>
              </SettingsSectionCard>
              {loading ? (
                <p className="text-sm text-primary/90">Loading settings...</p>
              ) : (
                <>
                  {/* Section 1: Agent Management */}
                  <SettingsSectionCard
                    className="border-primary/62 from-primary/36 via-primary/14 to-accent/24 ring-primary/30"
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
                    className="border-primary/58 from-primary/32 via-primary/14 to-accent/30 ring-accent/24"
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
                    className="border-accent/58 from-accent/30 via-accent/12 to-primary/24 ring-accent/24"
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

          <Separator className="bg-gradient-to-r from-transparent via-primary to-accent/90" />
          <SheetFooter className="border-t border-primary/55 bg-gradient-to-r from-primary/30 via-primary/10 to-accent/26 px-4 py-3">
            <Button
              variant="outline"
              className="border-primary/75 bg-primary/16 hover:border-accent/75 hover:bg-accent/24"
              onClick={handleReset}
              disabled={saving}
            >
              Reset to Defaults
            </Button>
            <Button
              className="bg-gradient-to-r from-primary via-primary to-accent text-primary-foreground shadow-lg shadow-primary/35 hover:brightness-105"
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
