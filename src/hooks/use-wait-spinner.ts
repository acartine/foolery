"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_WAIT_SPINNER_WORDS,
  formatWaitSpinnerLabel,
} from "@/lib/wait-spinner";

interface UseWaitSpinnerOptions {
  enabled: boolean;
  intervalMs?: number;
  words?: readonly string[];
}

const MIN_INTERVAL_MS = 120;
const DEFAULT_INTERVAL_MS = 320;

export function useWaitSpinner({
  enabled,
  intervalMs = DEFAULT_INTERVAL_MS,
  words = DEFAULT_WAIT_SPINNER_WORDS,
}: UseWaitSpinnerOptions): string {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    const cadenceMs = Math.max(MIN_INTERVAL_MS, Math.trunc(intervalMs));
    const timer = window.setInterval(() => {
      setStep((prev) => prev + 1);
    }, cadenceMs);

    return () => window.clearInterval(timer);
  }, [enabled, intervalMs]);

  return useMemo(
    () => formatWaitSpinnerLabel(enabled ? step : 0, words),
    [enabled, step, words]
  );
}
