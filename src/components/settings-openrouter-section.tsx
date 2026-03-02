"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Globe, Eye, EyeOff, CheckCircle2, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import type { OpenRouterSettings } from "@/lib/schemas";
import {
  fetchOpenRouterModels as fetchModelsApi,
  validateOpenRouterKey,
} from "@/lib/settings-api";
import { formatPricing } from "@/lib/openrouter";
import type { OpenRouterModel } from "@/lib/openrouter";


function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

interface OpenRouterSectionProps {
  openrouter: OpenRouterSettings;
  onOpenRouterChange: (openrouter: OpenRouterSettings) => void;
}

export function SettingsOpenRouterSection({
  openrouter,
  onOpenRouterChange,
}: OpenRouterSectionProps) {
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  const [models, setModels] = useState<OpenRouterModel[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelFilter, setModelFilter] = useState("");

  async function handleValidate() {
    if (!openrouter.apiKey.trim()) {
      toast.error("Enter an API key first");
      return;
    }
    setValidating(true);
    setKeyValid(null);
    try {
      const res = await validateOpenRouterKey(openrouter.apiKey);
      if (res.ok && res.data) {
        setKeyValid(res.data.valid);
        if (res.data.valid) {
          toast.success("API key is valid");
        } else {
          toast.error("API key is invalid");
        }
      } else {
        toast.error(res.error ?? "Validation failed");
      }
    } catch {
      toast.error("Validation request failed");
    } finally {
      setValidating(false);
    }
  }

  async function handleLoadModels() {
    setLoadingModels(true);
    try {
      const res = await fetchModelsApi();
      if (res.ok && res.data) {
        setModels(res.data);
        toast.success(`Loaded ${res.data.length} models`);
      } else {
        toast.error(res.error ?? "Failed to load models");
      }
    } catch {
      toast.error("Failed to fetch models");
    } finally {
      setLoadingModels(false);
    }
  }

  const filteredModels = models?.filter(
    (m) =>
      m.name.toLowerCase().includes(modelFilter.toLowerCase()) ||
      m.id.toLowerCase().includes(modelFilter.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">OpenRouter</h3>
        </div>
        <Switch
          checked={openrouter.enabled}
          onCheckedChange={(enabled) =>
            onOpenRouterChange({ ...openrouter, enabled })
          }
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Connect to OpenRouter for access to 200+ AI models from multiple
        providers with unified pricing.
      </p>

      {openrouter.enabled && (
        <div className="space-y-3">
          <ApiKeyField
            apiKey={openrouter.apiKey}
            showKey={showKey}
            validating={validating}
            keyValid={keyValid}
            onApiKeyChange={(apiKey) =>
              onOpenRouterChange({ ...openrouter, apiKey })
            }
            onToggleShow={() => setShowKey(!showKey)}
            onValidate={handleValidate}
          />

          {openrouter.model && (
            <SelectedModelBadge
              modelId={openrouter.model}
              onClear={() =>
                onOpenRouterChange({ ...openrouter, model: "" })
              }
            />
          )}

          <ModelsBrowser
            models={models}
            filteredModels={filteredModels ?? null}
            loadingModels={loadingModels}
            modelFilter={modelFilter}
            selectedModelId={openrouter.model}
            onFilterChange={setModelFilter}
            onLoadModels={handleLoadModels}
            onSelectModel={(id) =>
              onOpenRouterChange({ ...openrouter, model: id })
            }
          />
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────── */

interface SelectedModelBadgeProps {
  modelId: string;
  onClear: () => void;
}

function SelectedModelBadge({ modelId, onClear }: SelectedModelBadgeProps) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs">Selected Model</Label>
      <Badge variant="outline" className="gap-1 font-mono text-[11px]">
        {modelId}
        <button
          type="button"
          onClick={onClear}
          className="ml-0.5 rounded-full hover:bg-muted"
          aria-label="Clear selected model"
        >
          <X className="size-3" />
        </button>
      </Badge>
    </div>
  );
}

interface ApiKeyFieldProps {
  apiKey: string;
  showKey: boolean;
  validating: boolean;
  keyValid: boolean | null;
  onApiKeyChange: (key: string) => void;
  onToggleShow: () => void;
  onValidate: () => void;
}

function ApiKeyField({
  apiKey,
  showKey,
  validating,
  keyValid,
  onApiKeyChange,
  onToggleShow,
  onValidate,
}: ApiKeyFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">API Key</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder="sk-or-v1-..."
            className="pr-9"
          />
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-0 top-0 h-full px-2"
            onClick={onToggleShow}
          >
            {showKey ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onValidate}
          disabled={validating || !apiKey.trim()}
        >
          {validating ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : keyValid === true ? (
            <CheckCircle2 className="size-3.5 text-green-500" />
          ) : (
            "Validate"
          )}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Get your key at{" "}
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          openrouter.ai/keys
        </a>
      </p>
    </div>
  );
}

interface ModelsBrowserProps {
  models: OpenRouterModel[] | null;
  filteredModels: OpenRouterModel[] | null;
  loadingModels: boolean;
  modelFilter: string;
  selectedModelId: string;
  onFilterChange: (filter: string) => void;
  onLoadModels: () => void;
  onSelectModel: (id: string) => void;
}

function ModelsBrowser({
  models,
  filteredModels,
  loadingModels,
  modelFilter,
  selectedModelId,
  onFilterChange,
  onLoadModels,
  onSelectModel,
}: ModelsBrowserProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Available Models</Label>
        <Button
          variant="outline"
          size="sm"
          onClick={onLoadModels}
          disabled={loadingModels}
        >
          {loadingModels ? (
            <>
              <Loader2 className="size-3.5 mr-1 animate-spin" />
              Loading...
            </>
          ) : models ? (
            "Refresh"
          ) : (
            "Browse Models"
          )}
        </Button>
      </div>

      {models && (
        <div className="space-y-2">
          <Input
            placeholder="Filter models..."
            value={modelFilter}
            onChange={(e) => onFilterChange(e.target.value)}
            className="h-7 text-xs"
          />
          <ModelsTable
            models={filteredModels ?? []}
            selectedModelId={selectedModelId}
            onSelectModel={onSelectModel}
          />
          <p className="text-[10px] text-muted-foreground text-right">
            {filteredModels?.length ?? 0} of {models.length} models
          </p>
        </div>
      )}
    </div>
  );
}

interface ModelsTableProps {
  models: OpenRouterModel[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
}

function ModelsTable({ models, selectedModelId, onSelectModel }: ModelsTableProps) {
  return (
    <div className="max-h-[240px] overflow-y-auto rounded-md border">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-background border-b">
          <tr className="text-left text-muted-foreground">
            <th className="px-2 py-1.5 font-medium">Model</th>
            <th className="px-2 py-1.5 font-medium text-right">Context</th>
            <th className="px-2 py-1.5 font-medium text-right">Prompt</th>
            <th className="px-2 py-1.5 font-medium text-right">Completion</th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => {
            const isSelected = model.id === selectedModelId;
            return (
              <tr
                key={model.id}
                role="button"
                tabIndex={0}
                aria-selected={isSelected}
                className={`border-b border-border/50 cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-primary/10 hover:bg-primary/15"
                    : "hover:bg-muted/50"
                }`}
                onClick={() => onSelectModel(model.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectModel(model.id);
                  }
                }}
              >
                <td className="px-2 py-1.5">
                  <div
                    className="font-medium truncate max-w-[180px]"
                    title={model.id}
                  >
                    {model.name}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right text-muted-foreground">
                  {formatContext(model.context_length)}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Badge variant="secondary" className="text-[9px] font-mono">
                    {formatPricing(model.pricing.prompt)}
                  </Badge>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Badge variant="secondary" className="text-[9px] font-mono">
                    {formatPricing(model.pricing.completion)}
                  </Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {models.length === 0 && (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">
          No models match filter
        </p>
      )}
    </div>
  );
}
