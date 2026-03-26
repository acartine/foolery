import {
  useCallback, useEffect, useMemo,
} from "react";
import {
  useSearchParams, useRouter, usePathname,
} from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { Beat } from "@/lib/types";

interface UseBeatDetailArgs {
  beats: Beat[];
  detailBeatId: string | null;
  detailRepo: string | undefined;
  isListView: boolean;
}

export interface UseBeatDetailResult {
  initialDetailBeat: Beat | null;
  handleOpenBeat: (beat: Beat) => void;
  handleBeatLightboxOpenChange: (
    open: boolean,
  ) => void;
  handleMovedBeat: (
    newId: string,
    targetRepo: string,
  ) => void;
}

export function useBeatDetail(
  args: UseBeatDetailArgs,
): UseBeatDetailResult {
  const {
    beats, detailBeatId, detailRepo, isListView,
  } = args;
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const setBeatDetailParams = useCallback(
    (
      id: string | null,
      repo: string | undefined,
      mode: "push" | "replace",
    ) => {
      const p = new URLSearchParams(
        searchParams.toString(),
      );
      if (id) p.set("beat", id);
      else p.delete("beat");
      if (repo) p.set("detailRepo", repo);
      else p.delete("detailRepo");
      const qs = p.toString();
      const nextUrl = `${pathname}${
        qs ? `?${qs}` : ""
      }`;
      if (mode === "replace") router.replace(nextUrl);
      else router.push(nextUrl);
    },
    [searchParams, pathname, router],
  );

  useEffect(() => {
    if (!isListView && detailBeatId) {
      setBeatDetailParams(null, undefined, "replace");
    }
  }, [isListView, detailBeatId, setBeatDetailParams]);

  const handleOpenBeat = useCallback(
    (beat: Beat) => {
      const repo = (
        beat as unknown as Record<string, unknown>
      )._repoPath as string | undefined;
      setBeatDetailParams(beat.id, repo, "push");
    },
    [setBeatDetailParams],
  );

  const handleBeatLightboxOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setBeatDetailParams(
          null, undefined, "replace",
        );
      }
    },
    [setBeatDetailParams],
  );

  const handleMovedBeat = useCallback(
    (newId: string, targetRepo: string) => {
      setBeatDetailParams(
        newId, targetRepo, "replace",
      );
      queryClient.invalidateQueries({
        queryKey: ["beats"],
      });
    },
    [queryClient, setBeatDetailParams],
  );

  const initialDetailBeat = useMemo(() => {
    if (!detailBeatId) return null;
    return beats.find((beat) => {
      if (beat.id !== detailBeatId) return false;
      const beatRepo = (
        beat as unknown as Record<string, unknown>
      )._repoPath as string | undefined;
      return !detailRepo || beatRepo === detailRepo;
    }) ?? null;
  }, [beats, detailBeatId, detailRepo]);

  return {
    initialDetailBeat,
    handleOpenBeat,
    handleBeatLightboxOpenChange,
    handleMovedBeat,
  };
}
