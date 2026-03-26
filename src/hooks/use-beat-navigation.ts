import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AgentHistoryBeatSummary,
} from "@/lib/agent-history-types";
import {
  beatKey,
  WINDOW_SIZE,
} from "@/components/agent-history-utils";

export function useBeatNavigation(
  beats: AgentHistoryBeatSummary[],
) {
  const [focusedBeatKey, setFocusedBeatKey] =
    useState<string | null>(null);
  const [loadedBeatKey, setLoadedBeatKey] =
    useState<string | null>(null);
  const [windowStart, setWindowStart] =
    useState(0);

  const beatButtonRefs = useRef<
    Record<string, HTMLButtonElement | null>
  >({});
  const beatListRef =
    useRef<HTMLDivElement | null>(null);
  const consolePanelRef =
    useRef<HTMLDivElement | null>(null);
  const lastScrollDirectionRef =
    useRef<1 | -1>(1);

  const focusBeatList = useCallback(() => {
    const list = beatListRef.current;
    if (!list) return;
    if (document.activeElement === list) return;
    list.focus({ preventScroll: true });
  }, []);

  const focusConsolePanel = useCallback(() => {
    consolePanelRef.current?.focus();
  }, []);

  const visibleBeats = useMemo(
    () =>
      beats.slice(
        windowStart,
        windowStart + WINDOW_SIZE,
      ),
    [beats, windowStart],
  );

  useSyncFocusWithBeats(
    beats,
    focusedBeatKey,
    setFocusedBeatKey,
    loadedBeatKey,
    setLoadedBeatKey,
    setWindowStart,
  );

  useAutoFocusBeatList(beats.length, focusBeatList);

  useWindowAlignment(
    focusedBeatKey,
    beats,
    setWindowStart,
  );

  useScrollIntoView(
    focusedBeatKey,
    beatButtonRefs,
  );

  const moveFocusedBeat = useMoveFocusedBeat(
    beats,
    focusedBeatKey,
    setFocusedBeatKey,
    focusBeatList,
    lastScrollDirectionRef,
  );

  const focusedSummary = useMemo(
    () => findBeatByKey(beats, focusedBeatKey),
    [beats, focusedBeatKey],
  );
  const loadedSummary = useMemo(
    () => findBeatByKey(beats, loadedBeatKey),
    [beats, loadedBeatKey],
  );

  return {
    focusedBeatKey,
    setFocusedBeatKey,
    loadedBeatKey,
    setLoadedBeatKey,
    windowStart,
    beatButtonRefs,
    beatListRef,
    consolePanelRef,
    lastScrollDirectionRef,
    focusBeatList,
    focusConsolePanel,
    visibleBeats,
    moveFocusedBeat,
    focusedSummary,
    loadedSummary,
  };
}

function findBeatByKey(
  beats: AgentHistoryBeatSummary[],
  key: string | null,
): AgentHistoryBeatSummary | null {
  if (!key) return null;
  return (
    beats.find(
      (b) =>
        beatKey(b.beatId, b.repoPath) === key,
    ) ?? null
  );
}

function useSyncFocusWithBeats(
  beats: AgentHistoryBeatSummary[],
  focusedBeatKey: string | null,
  setFocusedBeatKey: (k: string | null) => void,
  loadedBeatKey: string | null,
  setLoadedBeatKey: (k: string | null) => void,
  setWindowStart: (n: number) => void,
) {
  useEffect(() => {
    if (beats.length === 0) {
      if (focusedBeatKey !== null) {
        setFocusedBeatKey(null);
      }
      if (loadedBeatKey !== null) {
        setLoadedBeatKey(null);
      }
      setWindowStart(0);
      return;
    }

    const focusedPresent =
      focusedBeatKey !== null
      && beats.some(
        (b) =>
          beatKey(b.beatId, b.repoPath)
          === focusedBeatKey,
      );
    if (!focusedPresent) {
      setFocusedBeatKey(
        beatKey(
          beats[0].beatId,
          beats[0].repoPath,
        ),
      );
    }

    const loadedPresent =
      loadedBeatKey === null
      || beats.some(
        (b) =>
          beatKey(b.beatId, b.repoPath)
          === loadedBeatKey,
      );
    if (!loadedPresent) {
      setLoadedBeatKey(null);
    }
  }, [
    beats,
    focusedBeatKey,
    loadedBeatKey,
    setFocusedBeatKey,
    setLoadedBeatKey,
    setWindowStart,
  ]);
}

function useAutoFocusBeatList(
  beatsLength: number,
  focusBeatList: () => void,
) {
  const autoFocusedRef = useRef(false);
  useEffect(() => {
    if (
      beatsLength > 0
      && !autoFocusedRef.current
    ) {
      autoFocusedRef.current = true;
      const raf = requestAnimationFrame(() => {
        focusBeatList();
      });
      return () => cancelAnimationFrame(raf);
    }
    if (beatsLength === 0) {
      autoFocusedRef.current = false;
    }
  }, [beatsLength, focusBeatList]);
}

function useWindowAlignment(
  focusedBeatKey: string | null,
  beats: AgentHistoryBeatSummary[],
  setWindowStart: (
    fn: (prev: number) => number,
  ) => void,
) {
  useEffect(() => {
    if (!focusedBeatKey || beats.length === 0) {
      return;
    }
    const idx = beats.findIndex(
      (b) =>
        beatKey(b.beatId, b.repoPath)
        === focusedBeatKey,
    );
    if (idx < 0) return;
    setWindowStart((prev: number) => {
      if (idx < prev) return idx;
      if (idx >= prev + WINDOW_SIZE) {
        return Math.max(
          0,
          idx - WINDOW_SIZE + 1,
        );
      }
      const maxStart = Math.max(
        0,
        beats.length - WINDOW_SIZE,
      );
      return Math.min(prev, maxStart);
    });
  }, [focusedBeatKey, beats, setWindowStart]);
}

function useScrollIntoView(
  focusedBeatKey: string | null,
  beatButtonRefs: React.MutableRefObject<
    Record<string, HTMLButtonElement | null>
  >,
) {
  useEffect(() => {
    if (!focusedBeatKey) return;
    const node =
      beatButtonRefs.current[focusedBeatKey];
    if (!node) return;
    node.scrollIntoView({ block: "nearest" });
  }, [focusedBeatKey, beatButtonRefs]);
}

function useMoveFocusedBeat(
  beats: AgentHistoryBeatSummary[],
  focusedBeatKey: string | null,
  setFocusedBeatKey: (k: string | null) => void,
  focusBeatList: () => void,
  lastScrollDirectionRef: React.MutableRefObject<
    1 | -1
  >,
) {
  return useCallback(
    (direction: -1 | 1) => {
      if (beats.length === 0) return;
      focusBeatList();
      lastScrollDirectionRef.current = direction;
      const curIdx = focusedBeatKey
        ? beats.findIndex(
          (b) =>
            beatKey(b.beatId, b.repoPath)
            === focusedBeatKey,
        )
        : -1;
      const nextIdx =
        curIdx === -1
          ? 0
          : Math.max(
            0,
            Math.min(
              beats.length - 1,
              curIdx + direction,
            ),
          );
      setFocusedBeatKey(
        beatKey(
          beats[nextIdx].beatId,
          beats[nextIdx].repoPath,
        ),
      );
    },
    [
      beats,
      focusedBeatKey,
      setFocusedBeatKey,
      focusBeatList,
      lastScrollDirectionRef,
    ],
  );
}
