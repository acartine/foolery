"use client";

import { useEffect } from "react";
import {
  exposeDiagnosticsHandle,
  initializeDiagnostics,
  isDiagnosticsEnabled,
  noteGcSuspect,
  recordClientPerfEvent,
  recordMeasureEntry,
  recordNavigationEntry,
  subscribeDiagnostics,
  toLongTaskEvent,
} from "@/lib/client-perf";
import { createPerfEvent } from "@/lib/perf-events";

interface MemoryLikePerformance extends Performance {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

const HEAP_DROP_BYTES = 8 * 1024 * 1024;
const HEAP_DROP_RATIO = 0.25;

export function ClientDiagnosticsRuntime() {
  useEffect(() => {
    initializeDiagnostics();
    exposeDiagnosticsHandle();
    return subscribeDiagnostics(exposeDiagnosticsHandle);
  }, []);

  useEffect(() => {
    if (!isDiagnosticsEnabled()) {
      return;
    }

    const observers: PerformanceObserver[] = [];
    const longTaskObserver = createObserver(["longtask"], (list) => {
      for (const entry of list.getEntries()) {
        const event = toLongTaskEvent(entry);
        if (event) {
          recordClientPerfEvent(event);
        }
      }
    });
    const measureObserver = createObserver(["measure", "navigation"], (list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === "measure") {
          recordMeasureEntry(entry as PerformanceMeasure);
        } else if (entry.entryType === "navigation") {
          recordNavigationEntry(entry as PerformanceNavigationTiming);
        }
      }
    });

    if (longTaskObserver) {
      observers.push(longTaskObserver);
    }
    if (measureObserver) {
      observers.push(measureObserver);
    }

    const stopHeapSampler = startHeapSampler();
    return () => {
      stopHeapSampler();
      for (const observer of observers) {
        observer.disconnect();
      }
    };
  }, []);

  return null;
}

function createObserver(
  entryTypes: string[],
  onEntries: (list: PerformanceObserverEntryList) => void,
): PerformanceObserver | null {
  if (typeof PerformanceObserver === "undefined") {
    return null;
  }
  try {
    const observer = new PerformanceObserver(onEntries);
    observer.observe({ entryTypes });
    return observer;
  } catch {
    return null;
  }
}

function startHeapSampler(): () => void {
  const perf = performance as MemoryLikePerformance;
  if (!perf.memory) {
    return () => undefined;
  }

  let previousHeap = perf.memory.usedJSHeapSize;
  const tick = () => {
    const memory = perf.memory;
    if (!memory || !isDiagnosticsEnabled()) {
      return;
    }

    const currentHeap = memory.usedJSHeapSize;
    recordClientPerfEvent(createPerfEvent({
      kind: "heap_sample",
      usedJSHeapSize: currentHeap,
      totalJSHeapSize: memory.totalJSHeapSize,
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
      route: window.location.pathname,
    }));

    const dropBytes = previousHeap - currentHeap;
    const dropRatio = previousHeap === 0 ? 0 : dropBytes / previousHeap;
    if (dropBytes >= HEAP_DROP_BYTES && dropRatio >= HEAP_DROP_RATIO) {
      noteGcSuspect(previousHeap, currentHeap);
    }
    previousHeap = currentHeap;
  };

  tick();
  const intervalId = window.setInterval(tick, 5_000);
  return () => {
    window.clearInterval(intervalId);
  };
}
