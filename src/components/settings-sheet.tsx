"use client";

import { useEffect, useState } from "react";
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
import { SettingsActionsSection } from "@/components/settings-actions-section";
import { fetchSettings, saveSettings } from "@/lib/settings-api";
import type { RegisteredAgent } from "@/lib/types";
import type { ActionAgentMappings } from "@/lib/schemas";

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SettingsData {
  agent: { command: string };
  agents: Record<string, RegisteredAgent>;
  actions: ActionAgentMappings;
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
};

export function SettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  const [settings, setSettings] = useState<SettingsData>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchSettings()
      .then((res) => {
        if (res.ok && res.data) {
          setSettings({
            agent: res.data.agent ?? DEFAULTS.agent,
            agents: res.data.agents ?? DEFAULTS.agents,
            actions: res.data.actions ?? DEFAULTS.actions,
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
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            Configuration stored in ~/.config/foolery/settings.toml
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 py-6 overflow-y-auto flex-1">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
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

              {/* Section 3: Legacy / Default Agent */}
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
