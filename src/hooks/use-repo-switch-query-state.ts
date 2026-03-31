"use client";

import { useEffect } from "react";
import type { FetchStatus } from "@tanstack/react-query";
import { useAppStore } from "@/stores/app-store";

interface RepoSwitchQueryState<TData> {
  data: TData | undefined;
  error: Error | null;
  fetchStatus: FetchStatus;
  isFetched: boolean;
  isLoading: boolean;
}

interface RepoSwitchDisplayArgs<TData>
  extends RepoSwitchQueryState<TData> {
  isSwitching: boolean;
}

interface RepoSwitchDisplayState<TData> {
  data: TData | undefined;
  isLoading: boolean;
}

export function deriveRepoSwitchDisplayState<TData>(
  args: RepoSwitchDisplayArgs<TData>,
): RepoSwitchDisplayState<TData> {
  const isSettled = args.fetchStatus === "idle"
    && (args.isFetched || args.error !== null);
  const shouldMaskData =
    args.isSwitching && !isSettled;

  return {
    data: shouldMaskData ? undefined : args.data,
    isLoading: args.isLoading || shouldMaskData,
  };
}

export function useRepoSwitchQueryState<TData>(
  scopeKey: string,
  query: RepoSwitchQueryState<TData>,
): RepoSwitchDisplayState<TData> {
  const pendingRepoScopeKey = useAppStore(
    (state) => state.pendingRepoScopeKey,
  );
  const isSettled = query.fetchStatus === "idle"
    && (query.isFetched || query.error !== null);

  useEffect(() => {
    if (
      pendingRepoScopeKey !== scopeKey
      || !isSettled
    ) {
      return;
    }
    useAppStore.getState().setPendingRepoScopeKey(
      null,
    );
  }, [pendingRepoScopeKey, scopeKey, isSettled]);

  return deriveRepoSwitchDisplayState({
    ...query,
    isSwitching: pendingRepoScopeKey === scopeKey,
  });
}
