"use client";

import {
  useState, useCallback, useRef,
} from "react";

export interface StreamingProgress {
  /** Total number of repos being loaded. */
  totalRepos: number;
  /** Repo paths that have finished loading. */
  loadedRepos: string[];
  /** Running count of beats received so far. */
  loadedBeatsCount: number;
  /** True while the streaming fetch is in flight. */
  isStreaming: boolean;
  /** True once all repos have responded. */
  isComplete: boolean;
}

const EMPTY_PROGRESS: StreamingProgress = {
  totalRepos: 0,
  loadedRepos: [],
  loadedBeatsCount: 0,
  isStreaming: false,
  isComplete: false,
};

export interface StreamingProgressHandle {
  progress: StreamingProgress;
  onStreamStart: (totalRepos: number) => void;
  onRepoLoaded: (
    repoPath: string, beatsCount: number,
  ) => void;
  onStreamComplete: () => void;
  resetProgress: () => void;
}

/**
 * Tracks per-repo streaming progress for the
 * all-repos NDJSON fetch.  State updates are batched
 * via React state so the UI re-renders as each repo
 * finishes.
 */
export function useStreamingProgress():
  StreamingProgressHandle {
  const [progress, setProgress] =
    useState<StreamingProgress>(EMPTY_PROGRESS);
  const totalRef = useRef(0);

  const onStreamStart = useCallback(
    (totalRepos: number) => {
      totalRef.current = totalRepos;
      setProgress({
        totalRepos,
        loadedRepos: [],
        loadedBeatsCount: 0,
        isStreaming: true,
        isComplete: false,
      });
    },
    [],
  );

  const onRepoLoaded = useCallback(
    (repoPath: string, beatsCount: number) => {
      setProgress((prev) => {
        const loaded = [...prev.loadedRepos, repoPath];
        return {
          ...prev,
          loadedRepos: loaded,
          loadedBeatsCount:
            prev.loadedBeatsCount + beatsCount,
        };
      });
    },
    [],
  );

  const onStreamComplete = useCallback(() => {
    setProgress((prev) => ({
      ...prev,
      isStreaming: false,
      isComplete: true,
    }));
  }, []);

  const resetProgress = useCallback(() => {
    totalRef.current = 0;
    setProgress(EMPTY_PROGRESS);
  }, []);

  return {
    progress,
    onStreamStart,
    onRepoLoaded,
    onStreamComplete,
    resetProgress,
  };
}
