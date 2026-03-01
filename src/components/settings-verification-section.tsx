"use client";

import { Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { RegisteredAgent } from "@/lib/types";
import type { VerificationSettings } from "@/lib/schemas";

interface SettingsVerificationSectionProps {
  verification: VerificationSettings;
  agents: Record<string, RegisteredAgent>;
  onVerificationChange: (verification: VerificationSettings) => void;
}

export function SettingsVerificationSection({
  verification,
  agents,
  onVerificationChange,
}: SettingsVerificationSectionProps) {
  const agentEntries = Object.entries(agents);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">Auto-Verification</h3>

      {/* Toggle */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Label htmlFor="verification-enabled" className="text-sm">
            Enable auto-verification
          </Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="size-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-64">
                <p className="text-xs">
                  When enabled, a verification agent automatically reviews code
                  changes after Take! and Scene! actions complete. This produces
                  more reliable results but is slightly slower. When disabled,
                  beats go directly to verification without automated review.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Switch
          id="verification-enabled"
          checked={verification.enabled}
          onCheckedChange={(checked) =>
            onVerificationChange({ ...verification, enabled: checked })
          }
        />
      </div>

      {/* Agent selector */}
      {verification.enabled && (
        <div className="space-y-2">
          <Label htmlFor="verification-agent" className="text-sm">
            Verification Agent
          </Label>
          <Select
            value={verification.agent || "default"}
            onValueChange={(value) =>
              onVerificationChange({
                ...verification,
                agent: value === "default" ? "" : value,
              })
            }
          >
            <SelectTrigger id="verification-agent" className="w-full">
              <SelectValue placeholder="Select agent..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default agent</SelectItem>
              {agentEntries.map(([id, agent]) => (
                <SelectItem key={id} value={id}>
                  {agent.label || id} ({agent.command})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Choose which agent performs the automated code review after
            implementation.
          </p>
        </div>
      )}
    </div>
  );
}
