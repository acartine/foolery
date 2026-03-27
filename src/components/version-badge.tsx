"use client";

import { useCallback, useState } from "react";
import { RefreshCw, Check, ArrowUpCircle } from "lucide-react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  VERSION_UPDATE_COMMAND,
  useVersionUpdateAction,
} from "@/components/version-update-action";
import { formatDisplayVersion } from "@/lib/version-display";

const APP_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
const DISPLAY_APP_VERSION =
  formatDisplayVersion(APP_VERSION);

export type VersionCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "update-available"; latestVersion: string }
  | { status: "error"; message: string };

/**
 * Fetch the version endpoint and return the resolved
 * check state. Extracted for testability.
 */
export async function checkForUpdates(
  signal?: AbortSignal,
): Promise<VersionCheckState> {
  const res = await fetch("/api/version?force=1", {
    method: "GET",
    signal,
  });
  if (!res.ok) {
    return {
      status: "error",
      message: "Version check failed",
    };
  }
  const json = (await res.json()) as {
    ok?: boolean;
    data?: {
      installedVersion?: string | null;
      latestVersion?: string | null;
      updateAvailable?: boolean;
    };
  };
  if (
    json?.data?.updateAvailable &&
    json.data.latestVersion
  ) {
    return {
      status: "update-available",
      latestVersion: json.data.latestVersion,
    };
  }
  return { status: "up-to-date" };
}

/**
 * Hook that manages the version-check lifecycle.
 */
export function useVersionCheck() {
  const [state, setState] =
    useState<VersionCheckState>({ status: "idle" });

  const check = useCallback(async () => {
    if (state.status === "checking") return;
    setState({ status: "checking" });
    try {
      const result = await checkForUpdates();
      setState(result);
    } catch {
      setState({
        status: "error",
        message: "Version check failed",
      });
    }
  }, [state.status]);

  return { state, check } as const;
}

/**
 * Cinematic version badge beside the app logo.
 * Clicking opens a popover to check for updates.
 */
export function VersionBadge() {
  const { state, check } = useVersionCheck();
  const { copied, triggerUpdate } =
    useVersionUpdateAction();

  const handleUpdateNow = useCallback(async () => {
    await triggerUpdate();
  }, [triggerUpdate]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="version-badge group relative inline-flex cursor-pointer select-none items-center"
          title={`Foolery ${DISPLAY_APP_VERSION} — click to check for updates`}
          onClick={check}
        >
          {/* Animated gradient border layer */}
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-md bg-[length:200%_200%] bg-[linear-gradient(135deg,transparent_30%,oklch(0.65_0.15_250)_45%,oklch(0.7_0.18_300)_55%,transparent_70%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-hover:animate-[shimmer_2s_ease-in-out_infinite]"
          />
          <span className="relative z-10 inline-flex items-center gap-1 rounded-[5px] bg-muted/60 px-1.5 py-0.5 ring-1 ring-border/50 transition-all duration-300 group-hover:bg-muted/80 group-hover:ring-transparent">
            <span
              aria-hidden="true"
              className="inline-block size-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_oklch(0.7_0.2_160)] transition-shadow duration-300 group-hover:shadow-[0_0_8px_oklch(0.7_0.2_160)]"
            />
            <span className="font-mono text-[10px] font-medium leading-none tracking-wider text-muted-foreground transition-colors duration-300 group-hover:text-foreground">
              {DISPLAY_APP_VERSION}
            </span>
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-64 p-3"
      >
        <VersionPopoverBody
          state={state}
          copied={copied}
          onCheck={check}
          onUpdateNow={handleUpdateNow}
        />
      </PopoverContent>
    </Popover>
  );
}

// ----------------------------------------------------------
// Popover body — extracted for clarity and testability
// ----------------------------------------------------------

export function VersionPopoverBody(props: {
  state: VersionCheckState;
  copied: boolean;
  onCheck: () => void;
  onUpdateNow: () => void;
}) {
  const { state, copied, onCheck, onUpdateNow } = props;

  if (state.status === "idle") {
    return (
      <div className="flex flex-col items-center gap-2 text-sm">
        <p className="text-muted-foreground">
          {DISPLAY_APP_VERSION}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={onCheck}
        >
          <RefreshCw className="size-3.5" />
          Check for updates
        </Button>
      </div>
    );
  }

  if (state.status === "checking") {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <RefreshCw className="size-3.5 animate-spin" />
        Checking for updates…
      </div>
    );
  }

  if (state.status === "up-to-date") {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-emerald-600">
        <Check className="size-4" />
        Latest version installed
      </div>
    );
  }

  if (state.status === "update-available") {
    return (
      <div className="flex flex-col items-center gap-2 text-sm">
        <p className="text-muted-foreground">
          {formatDisplayVersion(state.latestVersion)} available
        </p>
        <Button
          size="sm"
          variant="default"
          className="gap-1.5"
          onClick={onUpdateNow}
        >
          <ArrowUpCircle className="size-3.5" />
          {copied
            ? "Copied! Run in terminal"
            : `Update now to ${formatDisplayVersion(state.latestVersion)}`}
        </Button>
        <p className="text-xs text-muted-foreground">
          Copies{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
            {VERSION_UPDATE_COMMAND}
          </code>{" "}
          to clipboard
        </p>
      </div>
    );
  }

  // error
  return (
    <div className="flex flex-col items-center gap-2 text-sm">
      <p className="text-destructive">
        {state.message}
      </p>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={onCheck}
      >
        <RefreshCw className="size-3.5" />
        Retry
      </Button>
    </div>
  );
}
