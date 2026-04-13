"use client";

import { useState } from "react";
import { Info, Sun, Moon } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { InteractiveSessionTimeoutSection } from "@/components/settings-interactive-session-timeout-section";
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
import { Textarea } from "@/components/ui/textarea";
import { fetchWorkflows } from "@/lib/api";
import { resetLeaseAudit } from "@/lib/lease-audit-api";
import {
  DEFAULT_SCOPE_REFINEMENT_PROMPT,
} from "@/lib/scope-refinement-defaults";
import {
  profileDisplayName,
  PROFILE_DESCRIPTIONS,
} from "@/lib/workflows";
import type {
  DefaultsSettings,
  ScopeRefinementSettings,
} from "@/lib/schemas";

interface SettingsDefaultsSectionProps {
  defaults: DefaultsSettings;
  onDefaultsChange: (defaults: DefaultsSettings) => void;
  scopeRefinement: ScopeRefinementSettings;
  onScopeRefinementChange: (
    settings: ScopeRefinementSettings,
  ) => void;
  maxConcurrentSessions: number;
  onMaxConcurrentSessionsChange: (value: number) => void;
  terminalLightTheme: boolean;
  onTerminalLightThemeChange: (value: boolean) => void;
}

export function SettingsDefaultsSection({
  defaults,
  onDefaultsChange,
  scopeRefinement,
  onScopeRefinementChange,
  maxConcurrentSessions,
  onMaxConcurrentSessionsChange,
  terminalLightTheme,
  onTerminalLightThemeChange,
}: SettingsDefaultsSectionProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const { data: workflowResult } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => fetchWorkflows(),
  });
  const workflows =
    workflowResult?.ok && workflowResult.data
      ? workflowResult.data
      : [];
  const profileOptions = Array.from(
    new Map(
      workflows.map((wf) => {
        const id =
          (wf.profileId ?? wf.id).trim().toLowerCase();
        return [id, profileDisplayName(id)] as const;
      }),
    ).entries(),
  );
  const selectedProfileId =
    defaults.profileId.trim().toLowerCase() ||
    profileOptions.find(
      ([id]) => id === "autopilot",
    )?.[0] ||
    profileOptions[0]?.[0] ||
    "autopilot";

  return (
    <div className="space-y-3">
      <DefaultProfileSection
        selectedProfileId={selectedProfileId}
        profileOptions={profileOptions}
        defaults={defaults}
        onDefaultsChange={onDefaultsChange}
        onInfoOpen={() => setInfoOpen(true)}
      />
      <MaxConcurrentSessionsSection
        value={maxConcurrentSessions}
        onChange={onMaxConcurrentSessionsChange}
      />
      <InteractiveSessionTimeoutSection
        defaults={defaults}
        onDefaultsChange={onDefaultsChange}
      />
      <TerminalThemeSection
        lightTheme={terminalLightTheme}
        onChange={onTerminalLightThemeChange}
      />
      <ScopeRefinementSection
        scopeRefinement={scopeRefinement}
        onScopeRefinementChange={onScopeRefinementChange}
      />
      <ResetAuditSection />
      <ProfileInfoDialog
        open={infoOpen}
        onOpenChange={setInfoOpen}
      />
    </div>
  );
}

/* -------------------------------------------------- */
/*  Sub-components                                     */
/* -------------------------------------------------- */

type ProfileOption = readonly [string, string];

function DefaultProfileSection({
  selectedProfileId,
  profileOptions,
  defaults,
  onDefaultsChange,
  onInfoOpen,
}: {
  selectedProfileId: string;
  profileOptions: ProfileOption[];
  defaults: DefaultsSettings;
  onDefaultsChange: (d: DefaultsSettings) => void;
  onInfoOpen: () => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-accent/20 bg-background/60 p-3">
      <div className="flex items-center gap-1.5">
        <Label
          htmlFor="default-profile"
          className="text-xs"
        >
          Default Workflow Profile
        </Label>
        <button
          type="button"
          onClick={onInfoOpen}
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
        <SelectTrigger
          id="default-profile"
          className="w-full border-primary/20 bg-background/80"
        >
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
        The workflow profile pre-selected when creating
        new beats with Shift+N.
      </p>
    </div>
  );
}

function MaxConcurrentSessionsSection({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-accent/20 bg-background/60 p-3">
      <Label
        htmlFor="max-concurrent-sessions"
        className="text-xs"
      >
        Max Concurrent Sessions
      </Label>
      <Input
        id="max-concurrent-sessions"
        type="number"
        min={1}
        max={20}
        value={value}
        onChange={(e) => {
          const val = parseInt(e.target.value, 10);
          if (!isNaN(val) && val >= 1 && val <= 20) {
            onChange(val);
          }
        }}
        className="w-24 border-primary/20 bg-background/80"
      />
      <p className="text-[11px] text-muted-foreground">
        Maximum number of agent sessions that can run
        at the same time (1-20).
      </p>
    </div>
  );
}

function TerminalThemeSection({
  lightTheme,
  onChange,
}: {
  lightTheme: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-accent/20 bg-background/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <Label
            htmlFor="terminal-light-theme"
            className="text-xs"
          >
            Light Theme
          </Label>
          <p className="text-[11px] text-muted-foreground">
            Choose light or dark theme for the live
            and history terminals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lightTheme
            ? <Sun className="size-4 text-amber-500" />
            : <Moon className="size-4 text-slate-500" />}
          <Switch
            id="terminal-light-theme"
            checked={lightTheme}
            onCheckedChange={onChange}
            aria-label="Light Theme"
          />
        </div>
      </div>
    </div>
  );
}

function ScopeRefinementSection({
  scopeRefinement,
  onScopeRefinementChange,
}: {
  scopeRefinement: ScopeRefinementSettings;
  onScopeRefinementChange: (
    s: ScopeRefinementSettings,
  ) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-accent/20 bg-background/60 p-3">
      <div className="space-y-1">
        <Label className="text-xs">
          Scope Refinement
        </Label>
        <p className="text-[11px] text-muted-foreground">
          Runs automatically when agents are assigned
          to the Scope Refinement pool in Dispatch.
        </p>
      </div>
      <ScopeRefinementPrompt
        scopeRefinement={scopeRefinement}
        onScopeRefinementChange={onScopeRefinementChange}
      />
    </div>
  );
}

function ScopeRefinementPrompt({
  scopeRefinement,
  onScopeRefinementChange,
}: {
  scopeRefinement: ScopeRefinementSettings;
  onScopeRefinementChange: (
    s: ScopeRefinementSettings,
  ) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label
          htmlFor="scope-refinement-prompt"
          className="text-xs"
        >
          Prompt Template
        </Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 border-primary/20 bg-background/70 hover:bg-primary/10"
          onClick={() =>
            onScopeRefinementChange({
              ...scopeRefinement,
              prompt: DEFAULT_SCOPE_REFINEMENT_PROMPT,
            })
          }
        >
          Reset Prompt
        </Button>
      </div>
      <Textarea
        id="scope-refinement-prompt"
        value={scopeRefinement.prompt}
        onChange={(event) =>
          onScopeRefinementChange({
            ...scopeRefinement,
            prompt: event.target.value,
          })
        }
        className="min-h-40 border-primary/20 bg-background/80 text-xs"
      />
      <p className="text-[11px] text-muted-foreground">
        Supports <code>{"{{title}}"}</code>,{" "}
        <code>{"{{description}}"}</code>, and{" "}
        <code>{"{{acceptance}}"}</code>. The JSON response
        contract is enforced automatically.
      </p>
    </div>
  );
}

function ResetAuditSection() {
  const [resetting, setResetting] = useState(false);
  const queryClient = useQueryClient();

  return (
    <div className="space-y-2 rounded-xl border border-accent/20 bg-background/60 p-3">
      <Label className="text-xs">Reset Audit Data</Label>
      <p className="text-[11px] text-muted-foreground">
        Clear all audit events and agent success rate
        counters. Useful when testing or starting fresh.
      </p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="destructive"
            size="sm"
            disabled={resetting}
          >
            {resetting
              ? "Resetting\u2026"
              : "Reset Audit Counters"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reset audit counters?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all audit
              events and agent success rate aggregates.
              This action cannot be undone.
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
            Profiles control how work flows through
            planning, implementation, and shipment stages.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          {entries.map(([id, description]) => (
            <div key={id} className="space-y-0.5">
              <p className="text-xs font-medium">
                {profileDisplayName(id)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {description}
              </p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
