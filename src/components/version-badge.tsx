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
import type { AppUpdateStatus } from "@/lib/app-update-types";
import { formatDisplayVersion } from "@/lib/version-display";
import {
  fetchVersionStatus,
  type VersionStatusData,
} from "@/lib/version-status-client";

export type VersionCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | {
      status: "up-to-date";
      versionStatus: VersionStatusData;
    }
  | {
      status: "update-available";
      latestVersion: string;
      versionStatus: VersionStatusData;
    }
  | { status: "error"; message: string };

function displayInstalledVersion(
  installedVersion: string | null,
): string {
  return formatDisplayVersion(installedVersion, "version");
}

/**
 * Fetch the version endpoint and return the resolved
 * check state. Extracted for testability.
 */
export async function checkForUpdates(
  signal?: AbortSignal,
): Promise<VersionCheckState> {
  const versionStatus = await fetchVersionStatus({
    force: true,
    signal,
  });
  if (!versionStatus) {
    return {
      status: "error",
      message: "Version check failed",
    };
  }
  if (
    versionStatus.updateAvailable &&
    versionStatus.latestVersion
  ) {
    return {
      status: "update-available",
      latestVersion: versionStatus.latestVersion,
      versionStatus,
    };
  }
  return { status: "up-to-date", versionStatus };
}

/**
 * Hook that manages the version-check lifecycle.
 */
export function useVersionCheck(
  onVersionStatus?: (status: VersionStatusData) => void,
) {
  const [state, setState] =
    useState<VersionCheckState>({ status: "idle" });

  const check = useCallback(async () => {
    if (state.status === "checking") return;
    setState({ status: "checking" });
    try {
      const result = await checkForUpdates();
      if ("versionStatus" in result) {
        onVersionStatus?.(result.versionStatus);
      }
      setState(result);
    } catch {
      setState({
        status: "error",
        message: "Version check failed",
      });
    }
  }, [onVersionStatus, state.status]);

  return { state, check } as const;
}

export function VersionBadgeTrigger(props: {
  installedVersion: string | null;
  onCheck: () => void;
}) {
  const displayVersion =
    displayInstalledVersion(props.installedVersion);
  return (
    <button
      type="button"
      className="version-badge group relative inline-flex cursor-pointer select-none items-center"
      title={`Foolery ${displayVersion} — click to check for updates`}
      onClick={props.onCheck}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-md bg-[length:200%_200%] bg-[linear-gradient(135deg,transparent_30%,oklch(0.65_0.15_250)_45%,oklch(0.7_0.18_300)_55%,transparent_70%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-hover:animate-[shimmer_2s_ease-in-out_infinite]"
      />
      <span className="relative z-10 inline-flex items-center gap-1 rounded-[5px] bg-muted/60 px-1.5 py-0.5 ring-1 ring-border/50 transition-all duration-300 group-hover:bg-muted/80 group-hover:ring-transparent">
        <span
          aria-hidden="true"
          className="inline-block size-1.5 rounded-full bg-moss-500 shadow-[0_0_4px_oklch(0.7_0.2_160)] transition-shadow duration-300 group-hover:shadow-[0_0_8px_oklch(0.7_0.2_160)]"
        />
        <span className="font-mono text-[10px] font-medium leading-none tracking-wider text-muted-foreground transition-colors duration-300 group-hover:text-foreground">
          {displayVersion}
        </span>
      </span>
    </button>
  );
}

/**
 * Cinematic version badge beside the app logo.
 * Clicking opens a popover to check for updates.
 */
export function VersionBadge(props: {
  installedVersion: string | null;
  onVersionStatus: (status: VersionStatusData) => void;
}) {
  const { state, check } =
    useVersionCheck(props.onVersionStatus);
  const { status, triggerUpdate } =
    useVersionUpdateAction();

  const handleUpdateNow = useCallback(async () => {
    await triggerUpdate();
  }, [triggerUpdate]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <VersionBadgeTrigger
          installedVersion={props.installedVersion}
          onCheck={check}
        />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-64 p-3"
      >
        <VersionPopoverBody
          state={state}
          installedVersion={props.installedVersion}
          updateStatus={status}
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
  installedVersion: string | null;
  updateStatus: AppUpdateStatus;
  onCheck: () => void;
  onUpdateNow: () => void;
}) {
  const {
    state, installedVersion, updateStatus,
    onCheck, onUpdateNow,
  } = props;

  if (state.status === "idle") {
    return (
      <div className="flex flex-col items-center gap-2 text-sm">
        <p className="text-muted-foreground">
          {displayInstalledVersion(installedVersion)}
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
      <div className="flex items-center justify-center gap-2 text-sm text-moss-600">
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
        {renderUpdateActionControl(
          updateStatus,
          state.latestVersion,
          onUpdateNow,
        )}
        <p className="text-xs text-muted-foreground">
          {renderUpdateHelperText(updateStatus)}{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
            {VERSION_UPDATE_COMMAND}
          </code>{" "}
          .
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

function renderUpdateActionControl(
  updateStatus: AppUpdateStatus,
  latestVersion: string,
  onUpdateNow: () => void,
) {
  if (updateStatus.phase === "completed") {
    return (
      <div
        role="status"
        className="inline-flex items-center gap-1.5 rounded-md bg-moss-100 px-2.5 py-1 text-sm font-medium text-moss-700"
      >
        <Check className="size-3.5" />
        Update complete
      </div>
    );
  }

  return (
    <Button
      size="sm"
      variant="default"
      className="gap-1.5"
      disabled={isUpdateBusy(updateStatus)}
      onClick={onUpdateNow}
    >
      <ArrowUpCircle className="size-3.5" />
      {renderUpdateButtonLabel(
        updateStatus,
        latestVersion,
      )}
    </Button>
  );
}

function renderUpdateButtonLabel(
  status: AppUpdateStatus,
  latestVersion: string,
): string {
  if (status.phase === "starting" || status.phase === "updating") {
    return "Updating…";
  }
  if (status.phase === "restarting") {
    return "Restarting…";
  }
  if (status.phase === "completed") {
    return "Update complete";
  }
  if (status.phase === "failed") {
    return "Retry automatic update";
  }
  return `Update now to ${formatDisplayVersion(latestVersion)}`;
}

function isUpdateBusy(
  status: AppUpdateStatus,
): boolean {
  return (
    status.phase === "starting" ||
    status.phase === "updating" ||
    status.phase === "restarting"
  );
}

function renderUpdateHelperText(
  status: AppUpdateStatus,
): string {
  if (status.phase === "completed") {
    return "Automatic update finished. Refreshing page shortly. Manual fallback:";
  }
  if (status.phase === "failed") {
    return "Automatic update failed. Manual fallback:";
  }
  if (status.phase === "restarting") {
    return "Restarting Foolery. Manual fallback:";
  }
  return "Automatic local update. Manual fallback:";
}
