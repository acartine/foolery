"use client";

import { toast } from "sonner";
import { Zap, Users, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SettingsActionsSection } from "@/components/settings-actions-section";
import { SettingsPoolsSection } from "@/components/settings-pools-section";
import { SettingsDispatchGlobalSwap } from "@/components/settings-dispatch-global-swap";
import { patchSettings } from "@/lib/settings-api";
import type { RegisteredAgent } from "@/lib/types";
import type {
  ActionAgentMappings,
  PoolsSettings,
  DispatchMode,
} from "@/lib/schemas";

interface DispatchSectionProps {
  dispatchMode: DispatchMode;
  actions: ActionAgentMappings;
  pools: PoolsSettings;
  agents: Record<string, RegisteredAgent>;
  maxClaimsPerQueueType: number;
  onDispatchModeChange: (mode: DispatchMode) => void;
  onActionsChange: (actions: ActionAgentMappings) => void;
  onPoolsChange: (pools: PoolsSettings) => void;
  onMaxClaimsPerQueueTypeChange: (value: number) => void;
}

const MODES: {
  value: DispatchMode;
  label: string;
  description: string;
  icon: typeof Zap;
}[] = [
  {
    value: "basic",
    label: "Simple",
    description: "One agent per action",
    icon: Zap,
  },
  {
    value: "advanced",
    label: "Advanced",
    description: "Weighted pools per step/dispatch target",
    icon: Users,
  },
];

const ACTIVE_BG =
  "bg-[linear-gradient(135deg," +
  "rgba(168,85,247,0.14)," +
  "rgba(255,255,255,0.88)," +
  "rgba(74,222,128,0.14))]";

const ACTIVE_DARK_BG =
  "dark:bg-[linear-gradient(135deg," +
  "rgba(168,85,247,0.18)," +
  "rgba(39,39,42,0.9)," +
  "rgba(74,222,128,0.12))]";

function DispatchModeSelector({
  dispatchMode,
  onModeChange,
}: {
  dispatchMode: DispatchMode;
  onModeChange: (mode: DispatchMode) => void;
}) {
  return (
    <div className={
      "grid grid-cols-2 gap-2 rounded-xl bg-background/55 p-2"
    }>
      {MODES.map((mode) => {
        const Icon = mode.icon;
        const active = dispatchMode === mode.value;
        return (
          <button
            key={mode.value}
            type="button"
            onClick={() => onModeChange(mode.value)}
            className={cn(
              "relative flex flex-col items-start gap-1",
              "rounded-xl border p-3 text-left",
              "transition-colors",
              active
                ? [
                    "border-primary/35",
                    ACTIVE_BG,
                    "ring-1 ring-primary/15",
                    ACTIVE_DARK_BG,
                  ]
                : [
                    "border-border/70 bg-background/70",
                    "hover:border-primary/20",
                    "hover:bg-muted/45",
                  ],
            )}
          >
            {active && (
              <div className={
                "absolute top-2 right-2 flex size-4 " +
                "items-center justify-center " +
                "rounded-full bg-primary"
              }>
                <Check
                  className="size-2.5 text-primary-foreground"
                />
              </div>
            )}
            <Icon
              className={cn(
                "size-4",
                active
                  ? "text-primary"
                  : "text-muted-foreground",
              )}
            />
            <span
              className={cn(
                "text-xs font-medium",
                active
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {mode.label}
            </span>
            <span className={
              "text-[10px] text-muted-foreground"
            }>
              {mode.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const MAX_CLAIMS_HINT =
  "Maximum number of times a beat can be claimed " +
  "from the same queue type before the take-loop " +
  "exits with an error (1\u201350).";

function MaxClaimsInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className={
      "space-y-2 rounded-xl border " +
      "border-accent/20 bg-background/60 p-3"
    }>
      <Label
        htmlFor="max-claims-per-queue-type"
        className="text-xs"
      >
        Max Claims Per Queue Type
      </Label>
      <Input
        id="max-claims-per-queue-type"
        type="number"
        min={1}
        max={50}
        value={value}
        onChange={(e) => {
          const val = parseInt(e.target.value, 10);
          if (!isNaN(val) && val >= 1 && val <= 50) {
            onChange(val);
          }
        }}
        className={
          "w-24 border-primary/20 bg-background/80"
        }
      />
      <p className="text-[11px] text-muted-foreground">
        {MAX_CLAIMS_HINT}
      </p>
    </div>
  );
}

export function SettingsDispatchSection({
  dispatchMode,
  actions,
  pools,
  agents,
  maxClaimsPerQueueType,
  onDispatchModeChange,
  onActionsChange,
  onPoolsChange,
  onMaxClaimsPerQueueTypeChange,
}: DispatchSectionProps) {
  async function handleModeChange(
    mode: DispatchMode,
  ) {
    onDispatchModeChange(mode);
    try {
      const res = await patchSettings(
        { dispatchMode: mode },
      );
      if (!res.ok) {
        toast.error(
          res.error ?? "Failed to save dispatch mode",
        );
      }
    } catch {
      toast.error("Failed to save dispatch mode");
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        Choose how agents are assigned to
        workflow actions.
      </p>

      <DispatchModeSelector
        dispatchMode={dispatchMode}
        onModeChange={handleModeChange}
      />

      {dispatchMode === "basic" ? (
        <SettingsActionsSection
          actions={actions}
          agents={agents}
          onActionsChange={onActionsChange}
        />
      ) : (
        <SettingsPoolsSection
          pools={pools}
          agents={agents}
          onPoolsChange={onPoolsChange}
        />
      )}

      <MaxClaimsInput
        value={maxClaimsPerQueueType}
        onChange={onMaxClaimsPerQueueTypeChange}
      />

      <div className={
        "space-y-2 border-t border-border/70 pt-3"
      }>
        <div>
          <p className={
            "text-[11px] font-medium text-foreground"
          }>
            Swap Agent
          </p>
          <p className={
            "text-[10px] text-muted-foreground"
          }>
            Use this one Dispatch-level control to
            replace an agent everywhere. One swap
            updates every matching action mapping
            and every workflow-step pool entry.
          </p>
        </div>
        <SettingsDispatchGlobalSwap
          actions={actions}
          pools={pools}
          agents={agents}
          onActionsChange={onActionsChange}
          onPoolsChange={onPoolsChange}
        />
      </div>
    </div>
  );
}
