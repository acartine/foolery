"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { fetchWorkflows } from "@/lib/api";
import { profileDisplayName, PROFILE_DESCRIPTIONS } from "@/lib/workflows";
import type { DefaultsSettings } from "@/lib/schemas";

interface SettingsDefaultsSectionProps {
  defaults: DefaultsSettings;
  onDefaultsChange: (defaults: DefaultsSettings) => void;
}

export function SettingsDefaultsSection({
  defaults,
  onDefaultsChange,
}: SettingsDefaultsSectionProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const { data: workflowResult } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => fetchWorkflows(),
  });
  const workflows =
    workflowResult?.ok && workflowResult.data ? workflowResult.data : [];

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border border-accent/20 bg-background/60 p-3">
        <div className="flex items-center gap-1.5">
          <Label htmlFor="default-profile" className="text-xs">
            Default Workflow Profile
          </Label>
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Learn about workflow profiles"
          >
            <Info className="size-3.5" />
          </button>
        </div>
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
            <SelectItem value="auto">Autopilot</SelectItem>
            {workflows.map((wf) => (
              <SelectItem key={wf.id} value={wf.profileId ?? wf.id}>
                {profileDisplayName(wf.profileId ?? wf.id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          The workflow profile pre-selected when creating new beats with
          Shift+N.
        </p>
      </div>

      <ProfileInfoDialog open={infoOpen} onOpenChange={setInfoOpen} />
    </div>
  );
}

function ProfileInfoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const entries = Object.entries(PROFILE_DESCRIPTIONS);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Workflow Profiles</DialogTitle>
          <DialogDescription>
            Profiles control how work flows through planning, implementation,
            and shipment stages.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          {entries.map(([id, description]) => (
            <div key={id} className="space-y-0.5">
              <p className="text-xs font-medium">{profileDisplayName(id)}</p>
              <p className="text-[11px] text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
