"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
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
import type { RegisteredAgent } from "@/lib/types";
import type {
  ActionAgentMappings,
  BackendSettings,
  DefaultsSettings,
  OpenRouterSettings,
  PoolsSettings,
  DispatchMode,
} from "@/lib/schemas";
import { cn } from "@/lib/utils";

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

function SettingsSectionCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-primary/15 bg-[linear-gradient(135deg,rgba(168,85,247,0.08),rgba(255,255,255,0.92)_45%,rgba(74,222,128,0.08))] p-4 shadow-[0_18px_45px_-32px_rgba(88,28,135,0.55)] backdrop-blur-sm dark:bg-[linear-gradient(135deg,rgba(168,85,247,0.16),rgba(24,24,27,0.92)_48%,rgba(74,222,128,0.12))]",
        className,
      )}
    >
      {children}
    </section>
  );
}

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
      <SheetContent className="overflow-hidden border-primary/20 bg-[radial-gradient(circle_at_top_right,rgba(168,85,247,0.14),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(74,222,128,0.12),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(250,247,255,0.98))] sm:max-w-xl dark:bg-[radial-gradient(circle_at_top_right,rgba(168,85,247,0.24),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(74,222,128,0.16),transparent_24%),linear-gradient(180deg,rgba(31,23,39,0.98),rgba(24,24,27,0.98))]">
        <SheetHeader>
          <SheetTitle className="bg-gradient-to-r from-primary via-primary to-accent bg-clip-text text-transparent">
            Settings
          </SheetTitle>
          <SheetDescription className="text-muted-foreground/90">
            Configuration stored in ~/.config/foolery/settings.toml
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pt-2 flex-1 min-h-0 overflow-y-auto">
          <div className="space-y-3 py-4">
            {/* Section: Repositories (independent data, always rendered) */}
            <SettingsSectionCard className="border-accent/25">
              <div ref={reposSectionRef}>
                <SettingsReposSection />
              </div>
            </SettingsSectionCard>

            {loading ? (
              <p className="text-sm text-muted-foreground">Loading settings...</p>
            ) : (
              <>
                {/* Section 1: Agent Management */}
                <SettingsSectionCard className="border-primary/25">
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
                <SettingsSectionCard className="border-primary/25">
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
                <SettingsSectionCard className="border-accent/25">
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

        <Separator className="bg-gradient-to-r from-transparent via-primary/35 to-transparent" />
        <SheetFooter className="px-4 py-4">
          <Button
            variant="outline"
            className="border-primary/25 bg-background/70 hover:border-accent/35 hover:bg-accent/10"
            onClick={handleReset}
            disabled={saving}
          >
            Reset to Defaults
          </Button>
          <Button
            className="bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-[0_12px_30px_-18px_rgba(88,28,135,0.75)] hover:opacity-95"
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
