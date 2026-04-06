"use client";

import {
  useState, useCallback, useRef,
} from "react";

export interface StreamingProgress {
  /** Total number of repos being loaded. */
  totalRepos: number;
  /** Repo paths that have finished loading. */
  loadedRepos: string[];
  /** True while the streaming fetch is in flight. */
  isStreaming: boolean;
  /** True once all repos have responded. */
  isComplete: boolean;
}

const EMPTY_PROGRESS: StreamingProgress = {
  totalRepos: 0,
  loadedRepos: [],
  isStreaming: false,
  isComplete: false,
};

export interface StreamingProgressHandle {
  progress: StreamingProgress;
  onStreamStart: (totalRepos: number) => void;
  onRepoLoaded: (repoPath: string) => void;
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
        isStreaming: true,
        isComplete: false,
      });
    },
    [],
  );

  const onRepoLoaded = useCallback(
    (repoPath: string) => {
      setProgress((prev) => {
        const loaded = [...prev.loadedRepos, repoPath];
        const complete =
          loaded.length >= totalRef.current;
        return {
          ...prev,
          loadedRepos: loaded,
          isComplete: complete,
          isStreaming: !complete,
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
