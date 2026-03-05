"use client";

import { useQuery } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchWorkflows } from "@/lib/api";
import type { DefaultsSettings } from "@/lib/schemas";

interface SettingsDefaultsSectionProps {
  defaults: DefaultsSettings;
  onDefaultsChange: (defaults: DefaultsSettings) => void;
}

export function SettingsDefaultsSection({
  defaults,
  onDefaultsChange,
}: SettingsDefaultsSectionProps) {
  const { data: workflowResult } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => fetchWorkflows(),
  });
  const workflows =
    workflowResult?.ok && workflowResult.data ? workflowResult.data : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Settings2 className="size-4 text-primary drop-shadow-[0_0_8px_rgba(137,87,255,0.45)]" />
        <h3 className="bg-gradient-to-r from-primary to-accent bg-clip-text text-sm font-medium text-transparent">
          Defaults
        </h3>
      </div>

      <div className="space-y-2 rounded-lg border border-accent/70 bg-gradient-to-br from-accent/42 via-accent/14 to-primary/34 p-3 shadow-md shadow-accent/30 ring-1 ring-accent/35">
        <Label htmlFor="default-profile" className="text-sm">
          Default Workflow Profile
        </Label>
        <Select
          value={defaults.profileId || "auto"}
          onValueChange={(value) =>
            onDefaultsChange({
              ...defaults,
              profileId: value === "auto" ? "" : value,
            })
          }
        >
          <SelectTrigger
            id="default-profile"
            className="w-full border-primary/75 bg-gradient-to-r from-primary/26 via-background/70 to-accent/24 ring-1 ring-primary/30 shadow-sm shadow-primary/20 hover:border-accent/75 hover:shadow-accent/20"
          >
            <SelectValue placeholder="Select profile..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto (autopilot)</SelectItem>
            {workflows.map((wf) => (
              <SelectItem key={wf.id} value={wf.profileId ?? wf.id}>
                {wf.label || wf.profileId || wf.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The workflow profile pre-selected when creating new beats with
          Shift+N.
        </p>
      </div>
    </div>
  );
}
