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

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SettingsData {
  agent: { command: string };
}

const DEFAULTS: SettingsData = { agent: { command: "claude" } };

export function SettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  const [settings, setSettings] = useState<SettingsData>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/settings")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && json.data) setSettings(json.data);
      })
      .catch(() => toast.error("Failed to load settings"))
      .finally(() => setLoading(false));
  }, [open]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("Settings saved");
        setSettings(json.data);
      } else {
        toast.error(json.error ?? "Failed to save settings");
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

        <div className="space-y-6 px-4 py-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Agent</h3>
              <div className="space-y-2">
                <Label htmlFor="agent-command">Command</Label>
                <Input
                  id="agent-command"
                  value={settings.agent.command}
                  placeholder="claude"
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      agent: { ...prev.agent, command: e.target.value },
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  The CLI command used to spawn agent sessions (e.g. claude, codex).
                </p>
              </div>
            </div>
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
