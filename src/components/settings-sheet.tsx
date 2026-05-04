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
import { useTerminalThemePreference } from "@/hooks/use-terminal-theme-preference";
import {
  DEFAULT_INTERACTIVE_SESSION_TIMEOUT_MINUTES,
} from "@/lib/interactive-session-timeout";
import { DEFAULT_SCOPE_REFINEMENT_PROMPT } from "@/lib/scope-refinement-defaults";
import type { RegisteredAgent } from "@/lib/types";
import type {
  ActionAgentMappings,
  BackendSettings,
  DefaultsSettings,
  ScopeRefinementSettings,
  PoolsSettings,
  DispatchMode,
} from "@/lib/schemas";

export type SettingsSection = "repos" | "dispatch" | null;

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
  scopeRefinement: ScopeRefinementSettings;
  pools: PoolsSettings;
  dispatchMode: DispatchMode;
  maxConcurrentSessions: number;
  maxClaimsPerQueueType: number;
  terminalLightTheme: boolean;
}

const DEFAULTS: SettingsData = {
  agents: {},
  actions: {
    take: "",
    scene: "",
    scopeRefinement: "",
    staleGrooming: "",
  },
  backend: {
    type: "auto",
  },
  defaults: {
    profileId: "",
    interactiveSessionTimeoutMinutes:
      DEFAULT_INTERACTIVE_SESSION_TIMEOUT_MINUTES,
  },
  scopeRefinement: {
    prompt: DEFAULT_SCOPE_REFINEMENT_PROMPT,
  },
  pools: {
    orchestration: [],
    planning: [],
    plan_review: [],
    implementation: [],
    implementation_review: [],
    shipment: [],
    shipment_review: [],
    scope_refinement: [],
    stale_grooming: [],
  },
  dispatchMode: "basic",
  maxConcurrentSessions: 5,
  maxClaimsPerQueueType: 10,
  terminalLightTheme: false,
};

type SettingsTab = "repos" | "agents" | "dispatch" | "defaults";

type TabDef = {
  value: SettingsTab;
  label: string;
  icon: typeof Bot;
};

const TAB_DEFS: TabDef[] = [
  { value: "repos", label: "Repos", icon: FolderKanban },
  { value: "agents", label: "Agents", icon: Bot },
  { value: "dispatch", label: "Dispatch", icon: GitBranchPlus },
  { value: "defaults", label: "Defaults", icon: Settings2 },
];

function hydrateSettings(
  data: NonNullable<Awaited<ReturnType<typeof fetchSettings>>["data"]>,
): SettingsData {
  return {
    agents: data.agents ?? DEFAULTS.agents,
    actions: data.actions ?? DEFAULTS.actions,
    backend: data.backend ?? DEFAULTS.backend,
    defaults: data.defaults ?? DEFAULTS.defaults,
    scopeRefinement:
      data.scopeRefinement ?? DEFAULTS.scopeRefinement,
    pools: data.pools ?? DEFAULTS.pools,
    dispatchMode:
      data.dispatchMode ?? DEFAULTS.dispatchMode,
    maxConcurrentSessions:
      data.maxConcurrentSessions
        ?? DEFAULTS.maxConcurrentSessions,
    maxClaimsPerQueueType:
      data.maxClaimsPerQueueType
        ?? DEFAULTS.maxClaimsPerQueueType,
    terminalLightTheme:
      data.terminalLightTheme
        ?? DEFAULTS.terminalLightTheme,
  };
}

interface SettingsTabPanelsProps {
  settings: SettingsData;
  onTerminalLightThemeChange: (value: boolean) => void;
  onSettingsChange: React.Dispatch<
    React.SetStateAction<SettingsData>
  >;
}

function SettingsTabPanels({
  settings,
  onTerminalLightThemeChange,
  onSettingsChange,
}: SettingsTabPanelsProps) {
  return (
    <>
      <TabsContent value="repos">
        <SettingsReposSection />
      </TabsContent>

      <TabsContent value="agents">
        <SettingsAgentsSection
          agents={settings.agents}
          onSettingsChange={({
            agents,
            actions,
            pools,
          }) =>
            onSettingsChange((current) => ({
              ...current,
              agents,
              ...(actions ? { actions } : {}),
              ...(pools ? { pools } : {}),
            }))
          }
        />
      </TabsContent>

      <TabsContent value="dispatch">
        <SettingsDispatchSection
          dispatchMode={settings.dispatchMode}
          actions={settings.actions}
          pools={settings.pools}
          agents={settings.agents}
          maxClaimsPerQueueType={
            settings.maxClaimsPerQueueType
          }
          onDispatchModeChange={(dispatchMode) =>
            onSettingsChange((p) => ({
              ...p, dispatchMode,
            }))
          }
          onActionsChange={(actions) =>
            onSettingsChange((p) => ({
              ...p, actions,
            }))
          }
          onPoolsChange={(pools) =>
            onSettingsChange((p) => ({
              ...p, pools,
            }))
          }
          onMaxClaimsPerQueueTypeChange={(v) =>
            onSettingsChange((p) => ({
              ...p, maxClaimsPerQueueType: v,
            }))
          }
        />
      </TabsContent>

      <TabsContent value="defaults">
        <SettingsDefaultsSection
          defaults={settings.defaults}
          onDefaultsChange={(defaults) =>
            onSettingsChange((p) => ({
              ...p, defaults,
            }))
          }
          scopeRefinement={settings.scopeRefinement}
          onScopeRefinementChange={(scopeRefinement) =>
            onSettingsChange((p) => ({
              ...p, scopeRefinement,
            }))
          }
          maxConcurrentSessions={
            settings.maxConcurrentSessions
          }
          onMaxConcurrentSessionsChange={(v) =>
            onSettingsChange((p) => ({
              ...p, maxConcurrentSessions: v,
            }))
          }
          terminalLightTheme={settings.terminalLightTheme}
          onTerminalLightThemeChange={onTerminalLightThemeChange}
        />
      </TabsContent>
    </>
  );
}

interface SettingsFooterProps {
  saving: boolean;
  loading: boolean;
  onReset: () => void;
  onSave: () => void;
}

const SAVE_BTN_CLASS = [
  "bg-primary text-primary-foreground",
  "shadow-[0_12px_30px_-18px_rgba(88,28,135,0.55)]",
  "hover:bg-primary/90",
].join(" ");

const SEPARATOR_CLASS = [
  "shrink-0 bg-gradient-to-r",
  "from-transparent via-primary/35 to-transparent",
].join(" ");

const RESET_BTN_CLASS = [
  "border-primary/25 bg-background/70",
  "hover:border-accent/35 hover:bg-accent/10",
].join(" ");

function SettingsTabBar() {
  return (
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
  );
}

function SettingsFooter({
  saving,
  loading,
  onReset,
  onSave,
}: SettingsFooterProps) {
  return (
    <>
      <Separator className={SEPARATOR_CLASS} />
      <SheetFooter className="shrink-0 px-4 py-3">
        <Button
          variant="outline"
          size="sm"
          className={RESET_BTN_CLASS}
          onClick={onReset}
          disabled={saving}
        >
          Reset to Defaults
        </Button>
        <Button
          size="sm"
          className={SAVE_BTN_CLASS}
          onClick={onSave}
          disabled={saving || loading}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </SheetFooter>
    </>
  );
}

export function SettingsSheet({
  open,
  onOpenChange,
  initialSection,
}: SettingsSheetProps) {
  const queryClient = useQueryClient();
  const themePref = useTerminalThemePreference();
  const [settings, setSettings] =
    useState<SettingsData>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] =
    useState<SettingsTab>("repos");

  useEffect(() => {
    if (open && initialSection) {
      setActiveTab(initialSection);
    }
  }, [open, initialSection]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchSettings()
      .then((r) => {
        if (r.ok && r.data) setSettings(hydrateSettings(r.data));
      })
      .catch(() => toast.error("Failed to load settings"))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSettings((current) => {
      if (
        current.terminalLightTheme
        === themePref.lightTheme
      ) {
        return current;
      }
      return {
        ...current,
        terminalLightTheme: themePref.lightTheme,
      };
    });
  }, [open, themePref.lightTheme]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await saveSettings(settings);
      if (res.ok) {
        toast.success("Settings saved");
        if (res.data) setSettings(res.data);
        void queryClient.invalidateQueries({
          queryKey: ["settings"],
        });
      } else {
        toast.error(
          res.error ?? "Failed to save settings",
        );
      }
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSheetContent
      open={open}
      onOpenChange={onOpenChange}
      activeTab={activeTab}
      loading={loading}
      saving={saving}
      settings={settings}
      setSettings={setSettings}
      onActiveTabChange={setActiveTab}
      onTerminalLightThemeChange={(value) => {
        setSettings((p) => ({
          ...p,
          terminalLightTheme: value,
        }));
        themePref.setLightTheme(value);
      }}
      onReset={() =>
        setSettings({
          ...DEFAULTS,
          terminalLightTheme:
            themePref.lightTheme,
        })}
      onSave={handleSave}
    />
  );
}

function SettingsSheetContent({
  open,
  onOpenChange,
  activeTab,
  loading,
  saving,
  settings,
  setSettings,
  onActiveTabChange,
  onTerminalLightThemeChange,
  onReset,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: SettingsTab;
  loading: boolean;
  saving: boolean;
  settings: SettingsData;
  setSettings: React.Dispatch<
    React.SetStateAction<SettingsData>
  >;
  onActiveTabChange: (tab: SettingsTab) => void;
  onTerminalLightThemeChange: (
    value: boolean,
  ) => void;
  onReset: () => void;
  onSave: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={
          "overflow-hidden border-primary/20"
          + " bg-background sm:max-w-xl"
        }
      >
        <Tabs
          value={activeTab}
          onValueChange={(v) =>
            onActiveTabChange(v as SettingsTab)
          }
          className="flex flex-col flex-1 min-h-0"
        >
          <SettingsTabBar />

          <div className="px-4 flex-1 min-h-0 overflow-y-auto">
            <div className="py-3">
              {loading ? (
                <p className="text-xs text-muted-foreground">
                  Loading settings...
                </p>
              ) : (
                <SettingsTabPanels
                  settings={settings}
                  onTerminalLightThemeChange={
                    onTerminalLightThemeChange
                  }
                  onSettingsChange={setSettings}
                />
              )}
            </div>
          </div>
        </Tabs>

        <SettingsFooter
          saving={saving}
          loading={loading}
          onReset={onReset}
          onSave={onSave}
        />
      </SheetContent>
    </Sheet>
  );
}
