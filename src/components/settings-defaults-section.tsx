"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { fetchWorkflows } from "@/lib/api";
import { resetLeaseAudit } from "@/lib/lease-audit-api";
import { profileDisplayName, PROFILE_DESCRIPTIONS } from "@/lib/workflows";
import type { DefaultsSettings } from "@/lib/schemas";

interface SettingsDefaultsSectionProps {
  defaults: DefaultsSettings;
  onDefaultsChange: (defaults: DefaultsSettings) => void;
  maxConcurrentSessions: number;
  onMaxConcurrentSessionsChange: (value: number) => void;
}

export function SettingsDefaultsSection({
  defaults,
  onDefaultsChange,
  maxConcurrentSessions,
  onMaxConcurrentSessionsChange,
}: SettingsDefaultsSectionProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const queryClient = useQueryClient();
  const { data: workflowResult } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => fetchWorkflows(),
  });
  const workflows =
    workflowResult?.ok && workflowResult.data ? workflowResult.data : [];
  const profileOptions = Array.from(
    new Map(
      workflows.map((wf) => {
        const id = (wf.profileId ?? wf.id).trim().toLowerCase();
        return [id, profileDisplayName(id)] as const;
      }),
    ).entries(),
  );
  const selectedProfileId =
    defaults.profileId.trim().toLowerCase() ||
    profileOptions.find(([id]) => id === "autopilot")?.[0] ||
    profileOptions[0]?.[0] ||
    "autopilot";

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
          value={selectedProfileId}
          onValueChange={(value) =>
            onDefaultsChange({
              ...defaults,
              profileId: value,
            })
          }
        >
          <SelectTrigger id="default-profile" className="w-full border-primary/20 bg-background/80">
            <SelectValue placeholder="Select profile..." />
          </SelectTrigger>
          <SelectContent>
            {profileOptions.map(([id, label]) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          The workflow profile pre-selected when creating new beats with
          Shift+N.
        </p>
      </div>

      <div className="space-y-2 rounded-xl border border-accent/20 bg-background/60 p-3">
        <Label htmlFor="max-concurrent-sessions" className="text-xs">
          Max Concurrent Sessions
        </Label>
        <Input
          id="max-concurrent-sessions"
          type="number"
          min={1}
          max={20}
          value={maxConcurrentSessions}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            if (!isNaN(val) && val >= 1 && val <= 20) {
              onMaxConcurrentSessionsChange(val);
            }
          }}
          className="w-24 border-primary/20 bg-background/80"
        />
        <p className="text-[11px] text-muted-foreground">
          Maximum number of agent sessions that can run at the same time (1–20).
        </p>
      </div>

      <div className="space-y-2 rounded-xl border border-accent/20 bg-background/60 p-3">
        <Label className="text-xs">Reset Audit Data</Label>
        <p className="text-[11px] text-muted-foreground">
          Clear all audit events and agent success rate counters. Useful when
          testing or starting fresh.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={resetting}>
              {resetting ? "Resetting…" : "Reset Audit Counters"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset audit counters?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete all audit events and agent success
                rate aggregates. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={async () => {
                  setResetting(true);
                  try {
                    await resetLeaseAudit();
                    await queryClient.invalidateQueries({
                      queryKey: ["lease-audit"],
                    });
                    toast.success("Audit counters reset");
                  } catch (err) {
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : "Failed to reset audit data",
                    );
                  } finally {
                    setResetting(false);
                  }
                }}
              >
                Reset
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
