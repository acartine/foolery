"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Globe, Eye, EyeOff, CheckCircle2, Loader2, X, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
  const [securityDialogOpen, setSecurityDialogOpen] = useState(false);

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
  const selectedModel =
    models?.find((model) => model.id === openrouter.model) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-primary drop-shadow-[0_0_8px_rgba(137,87,255,0.45)]" />
          <h3 className="bg-gradient-to-r from-primary to-accent bg-clip-text text-sm font-medium text-transparent">
            OpenRouter
          </h3>
        </div>
        <Switch
          checked={openrouter.enabled}
          onCheckedChange={(enabled) =>
            onOpenRouterChange({ ...openrouter, enabled })
          }
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border border-accent/45 bg-gradient-to-r from-primary/20 via-primary/8 to-accent/20 px-3 py-2 ring-1 ring-primary/20">
        <p className="text-xs text-primary/95">
          Connect to OpenRouter for access to 200+ AI models from multiple
          providers with unified pricing.
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 gap-1 border border-primary/45 bg-gradient-to-r from-primary/20 to-accent/18 px-2 text-[10px] text-primary shadow-sm shadow-primary/20 hover:border-accent/65 hover:from-primary/28 hover:to-accent/26"
          onClick={() => setSecurityDialogOpen(true)}
        >
          <ShieldCheck className="size-3" />
          Is This Secure?
        </Button>
      </div>

      <SecurityInfoDialog
        open={securityDialogOpen}
        onOpenChange={setSecurityDialogOpen}
      />

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
              model={selectedModel}
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
  model: OpenRouterModel | null;
  onClear: () => void;
}

function SelectedModelBadge({ modelId, model, onClear }: SelectedModelBadgeProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/45 bg-gradient-to-r from-accent/24 via-background/75 to-primary/20 p-2 ring-1 ring-accent/20">
      <Label className="text-xs">Selected Model</Label>
      <Badge
        variant="outline"
        className="gap-1 border-primary/55 bg-gradient-to-r from-primary/18 via-background/80 to-accent/18 font-mono text-[11px]"
      >
        {modelId}
        <button
          type="button"
          onClick={onClear}
          className="ml-0.5 rounded-full hover:bg-accent/22"
          aria-label="Clear selected model"
        >
          <X className="size-3" />
        </button>
      </Badge>
      {model && (
        <>
          <Badge variant="secondary" className="font-mono text-[10px]">
            Prompt {formatPricing(model.pricing.prompt)}
          </Badge>
          <Badge variant="secondary" className="border border-primary/35 bg-gradient-to-r from-primary/18 to-accent/16 font-mono text-[10px]">
            Completion {formatPricing(model.pricing.completion)}
          </Badge>
        </>
      )}
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
  const isMasked = apiKey.includes("...");

  return (
    <div className="space-y-1.5 rounded-lg border border-primary/50 bg-gradient-to-r from-primary/20 via-background/80 to-accent/22 p-2.5 ring-1 ring-primary/25 shadow-sm shadow-primary/20">
      <Label className="text-xs">API Key</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder="sk-or-v1-..."
            className="border-primary/60 bg-gradient-to-r from-primary/16 via-background/82 to-accent/16 pr-9 focus-visible:ring-accent/45"
          />
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-0 top-0 h-full px-2 text-primary hover:bg-primary/14 hover:text-primary"
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
          className="border-accent/55 bg-gradient-to-r from-accent/18 via-background/85 to-primary/16 hover:border-primary/60 hover:bg-primary/20"
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
      {isMasked && (
        <p className="text-[10px] text-muted-foreground">
          Key is stored server-side. Clear the field and type a new key to
          update.
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">
        Get your key at{" "}
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline decoration-accent/80 underline-offset-2"
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
    <div className="space-y-2 rounded-lg border border-accent/45 bg-gradient-to-r from-accent/18 via-background/80 to-primary/18 p-2.5 ring-1 ring-accent/22 shadow-sm shadow-accent/20">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Available Models</Label>
        <Button
          variant="outline"
          size="sm"
          className="border-primary/50 bg-gradient-to-r from-primary/16 via-background/85 to-accent/14 hover:border-accent/65 hover:bg-accent/20"
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
            className="h-7 border-primary/55 bg-gradient-to-r from-primary/16 via-background/84 to-accent/16 text-xs"
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

interface SecurityInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function SecurityInfoDialog({ open, onOpenChange }: SecurityInfoDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-primary/65 bg-gradient-to-br from-primary/30 via-background/90 to-accent/26 shadow-xl shadow-primary/20 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            Is This Secure?
          </DialogTitle>
          <DialogDescription className="text-primary/90">
            How your OpenRouter API key is protected.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <section>
            <h4 className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Storage
            </h4>
            <ul className="list-disc list-inside space-y-0.5 text-xs text-foreground/80">
              <li>Stored in your OS keychain (macOS Keychain / Linux secret-service) when available.</li>
              <li>Falls back to <code className="text-[10px] bg-muted px-1 rounded">~/.config/foolery/settings.toml</code> with owner-only permissions (0600).</li>
              <li>Excluded from version control via <code className="text-[10px] bg-muted px-1 rounded">.gitignore</code>.</li>
            </ul>
          </section>
          <section>
            <h4 className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-1">
              In transit
            </h4>
            <ul className="list-disc list-inside space-y-0.5 text-xs text-foreground/80">
              <li>The full key never leaves the server — the browser only sees a masked version.</li>
              <li>Validation uses the stored key server-side; the browser does not send it.</li>
            </ul>
          </section>
          <section>
            <h4 className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Remaining risks
            </h4>
            <ul className="list-disc list-inside space-y-0.5 text-xs text-foreground/80">
              <li>Localhost HTTP traffic is unencrypted (accessible only on your machine).</li>
              <li>The key exists in server process memory while running.</li>
              <li>If the OS keychain is unavailable, the key is stored in a local file.</li>
            </ul>
          </section>
          <section>
            <h4 className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Recommendations
            </h4>
            <ul className="list-disc list-inside space-y-0.5 text-xs text-foreground/80">
              <li>Use a dedicated, scoped API key for Foolery.</li>
              <li>Rotate your key regularly at{" "}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline decoration-accent/80 underline-offset-2"
                >
                  openrouter.ai/keys
                </a>.
              </li>
              <li>Set a spend limit on your OpenRouter account.</li>
            </ul>
          </section>
        </div>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

interface ModelsTableProps {
  models: OpenRouterModel[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
}

function ModelsTable({ models, selectedModelId, onSelectModel }: ModelsTableProps) {
  return (
    <div className="max-h-[240px] overflow-y-auto rounded-md border border-primary/50 bg-gradient-to-br from-primary/14 via-background/86 to-accent/14 ring-1 ring-primary/25">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 border-b border-primary/35 bg-gradient-to-r from-primary/24 via-background to-accent/20">
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
                    ? "bg-gradient-to-r from-primary/30 to-accent/24 hover:from-primary/36 hover:to-accent/32"
                    : "hover:bg-gradient-to-r hover:from-primary/14 hover:to-accent/14"
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
                  <Badge variant="secondary" className="border border-primary/35 bg-gradient-to-r from-primary/18 to-accent/16 text-[9px] font-mono">
                    {formatPricing(model.pricing.prompt)}
                  </Badge>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Badge variant="secondary" className="border border-accent/35 bg-gradient-to-r from-accent/18 to-primary/16 text-[9px] font-mono">
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
