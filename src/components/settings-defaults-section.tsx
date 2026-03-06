"use client";

import { useQuery } from "@tanstack/react-query";
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
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border border-accent/20 bg-background/60 p-3">
        <Label htmlFor="default-profile" className="text-xs">
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
          <SelectTrigger id="default-profile" className="w-full border-primary/20 bg-background/80">
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
        <p className="text-[11px] text-muted-foreground">
          The workflow profile pre-selected when creating new beats with
          Shift+N.
        </p>
      </div>
    </div>
  );
}
