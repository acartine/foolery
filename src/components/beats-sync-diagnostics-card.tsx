"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { BeatsSyncState } from "@/lib/beats-sync-state";

type SyncState = Pick<BeatsSyncState, "running" | "lastCompletedSync">;

export function BeatsSyncDiagnosticsCard() {
  const [state, setState] = useState<SyncState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const response = await fetch("/api/sync/beats", { cache: "no-store" });
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setError(payload.error ?? "Unable to load sync diagnostics");
          return;
        }
        setState({
          running: Boolean(payload.running),
          lastCompletedSync: payload.lastCompletedSync ?? null,
        });
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }
    void refresh();
    const intervalId = window.setInterval(refresh, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const latest = state?.lastCompletedSync ?? null;
  const successful = latest?.status === "success";
  const Icon = latest ? (successful ? CheckCircle2 : XCircle) : RefreshCw;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Knots/Beats Sync</CardTitle>
            <CardDescription>
              Latest completed synchronization data and result.
            </CardDescription>
          </div>
          <Icon className={successful ? "size-5 text-emerald-600" : "size-5 text-muted-foreground"} />
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <SyncEmptyState text={error} />
        ) : latest ? (
          <div className="space-y-3">
            <SyncFields
              rows={[
                ["Status", latest.status],
                ["Completed", formatTimestamp(latest.completedAt)],
                ["Repository", latest.repoPath],
                ["Backend", latest.memoryManagerType],
                ["Command", latest.command],
                ["Runner", state?.running ? "running" : "idle"],
              ]}
            />
            <SyncPayloadBlock
              stdout={latest.payload.stdout}
              stderr={latest.payload.stderr}
              error={latest.payload.error}
            />
          </div>
        ) : (
          <SyncEmptyState text="No completed sync has been recorded yet." />
        )}
      </CardContent>
    </Card>
  );
}

function SyncFields({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid gap-2 text-sm md:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
          <dd className="truncate font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SyncPayloadBlock({
  stdout,
  stderr,
  error,
}: {
  stdout: string | null;
  stderr: string | null;
  error: string | null;
}) {
  const lines = [
    stdout ? `stdout:\n${stdout}` : null,
    stderr ? `stderr:\n${stderr}` : null,
    error ? `error:\n${error}` : null,
  ].filter(Boolean);
  const text = lines.length > 0 ? lines.join("\n\n") : "No output payload.";

  return (
    <pre className="max-h-56 overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
      {text}
    </pre>
  );
}

function SyncEmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}
