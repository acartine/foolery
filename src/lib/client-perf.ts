"use client";

import {
  buildPerfMeasureName,
  createPerfEvent,
  parsePerfMeasureName,
  summarizeClientPerfEvents,
  type ClientPerfBatchPayload,
  type ClientPerfEvent,
  type DiagnosticsSummary,
  type LongTaskEvent,
} from "@/lib/perf-events";

const DIAGNOSTICS_STORAGE_KEY = "foolery:diagnostics-enabled";
const MAX_STORED_EVENTS = 400;
const FLUSH_BATCH_SIZE = 25;
const FLUSH_DEBOUNCE_MS = 2_000;

type DiagnosticsListener = () => void;

interface DiagnosticsState {
  enabled: boolean;
  initialized: boolean;
  events: ClientPerfEvent[];
  listeners: Set<DiagnosticsListener>;
  flushTimer: number | null;
  flushInFlight: Promise<void> | null;
  flushCursor: number;
}

interface MemoryLikePerformance extends Performance {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
  measureUserAgentSpecificMemory?: () => Promise<{
    bytes: number;
    breakdown?: Array<{
      bytes: number;
      attribution?: Array<{ url?: string }>;
      types?: string[];
    }>;
  }>;
}

interface DiagnosticsHandle {
  getSnapshot: typeof getDiagnosticsSnapshot;
  isEnabled: typeof isDiagnosticsEnabled;
  setEnabled: typeof setDiagnosticsEnabled;
  samplePreciseMemory: typeof samplePreciseMemory;
}

const state: DiagnosticsState = {
  enabled: false,
  initialized: false,
  events: [],
  listeners: new Set(),
  flushTimer: null,
  flushInFlight: null,
  flushCursor: 0,
};

export function initializeDiagnostics(): boolean {
  if (state.initialized || typeof window === "undefined") {
    return state.enabled;
  }

  const fromQuery = new URLSearchParams(window.location.search).get("diagnostics") === "1";
  const fromStorage = window.localStorage.getItem(DIAGNOSTICS_STORAGE_KEY) === "1";
  state.enabled = fromQuery || fromStorage;
  if (fromQuery || fromStorage) {
    window.localStorage.setItem(DIAGNOSTICS_STORAGE_KEY, "1");
  }
  state.initialized = true;
  return state.enabled;
}

export function exposeDiagnosticsHandle(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.__FOOLERY_DIAGNOSTICS__ = {
    getSnapshot: getDiagnosticsSnapshot,
    isEnabled: isDiagnosticsEnabled,
    setEnabled: setDiagnosticsEnabled,
    samplePreciseMemory,
  };
}

export function isDiagnosticsEnabled(): boolean {
  return initializeDiagnostics();
}

export function setDiagnosticsEnabled(enabled: boolean): void {
  initializeDiagnostics();
  if (state.enabled === enabled || typeof window === "undefined") {
    return;
  }
  state.enabled = enabled;
  window.localStorage.setItem(DIAGNOSTICS_STORAGE_KEY, enabled ? "1" : "0");
  emit();
}

export function subscribeDiagnostics(listener: DiagnosticsListener): () => void {
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

export function getDiagnosticsSnapshot(): {
  enabled: boolean;
  summary: DiagnosticsSummary;
  recentEvents: ClientPerfEvent[];
  capabilities: {
    coarseHeap: boolean;
    preciseHeap: boolean;
  };
} {
  initializeDiagnostics();
  return {
    enabled: state.enabled,
    summary: summarizeClientPerfEvents(state.events),
    recentEvents: [...state.events].reverse().slice(0, 40),
    capabilities: {
      coarseHeap: hasCoarseHeapSupport(),
      preciseHeap: hasPreciseHeapSupport(),
    },
  };
}

export function recordClientPerfEvent(
  event: ClientPerfEvent,
  options: { emit?: boolean } = {},
): void {
  initializeDiagnostics();
  if (!state.enabled) {
    return;
  }
  const nextEvents = [...state.events, event];
  const droppedCount = Math.max(0, nextEvents.length - MAX_STORED_EVENTS);
  state.events = droppedCount > 0
    ? nextEvents.slice(droppedCount)
    : nextEvents;
  if (droppedCount > 0) {
    state.flushCursor = Math.max(0, state.flushCursor - droppedCount);
  }
  if (options.emit !== false) {
    emit();
  }
  scheduleFlush();
}

export function noteGcSuspect(beforeUsedJSHeapSize: number, afterUsedJSHeapSize: number): void {
  if (!state.enabled) {
    return;
  }
  const dropBytes = beforeUsedJSHeapSize - afterUsedJSHeapSize;
  const dropRatio = beforeUsedJSHeapSize === 0 ? 0 : dropBytes / beforeUsedJSHeapSize;
  recordClientPerfEvent(createPerfEvent({
    kind: "gc_suspect",
    beforeUsedJSHeapSize,
    afterUsedJSHeapSize,
    dropBytes,
    dropRatio,
  }));
}

export function markClientSpan(
  category: "api" | "query" | "view",
  label: string,
): {
  name: string;
  startMark: string;
  endMark: string;
} {
  const spanId = createSpanId();
  const name = buildPerfMeasureName(category, label, spanId);
  const startMark = `${name}:start`;
  const endMark = `${name}:end`;
  spanIdsByLabel.set(`${category}:${label}`, spanId);
  if (typeof performance !== "undefined") {
    performance.mark(startMark);
  }
  return { name, startMark, endMark };
}

export function finishClientSpan(span: {
  name: string;
  startMark: string;
  endMark: string;
}): void {
  if (typeof performance === "undefined") {
    return;
  }
  performance.mark(span.endMark);
  performance.measure(span.name, span.startMark, span.endMark);
  performance.clearMarks(span.startMark);
  performance.clearMarks(span.endMark);
}

export async function withClientPerfSpan<T>(
  category: "api" | "query" | "view",
  label: string,
  run: () => Promise<T>,
  resolveMeta?: (
    result: T | null,
    error: unknown,
  ) => Record<string, unknown> | undefined,
): Promise<T> {
  if (!isDiagnosticsEnabled()) {
    return run();
  }

  const span = markClientSpan(category, label);
  let result: T | null = null;
  let error: unknown = null;
  try {
    result = await run();
    return result;
  } catch (caughtError) {
    error = caughtError;
    throw caughtError;
  } finally {
    finishClientSpan(span);
    const meta = resolveMeta?.(result, error);
    recordSpanEvent(category, label, meta, error);
  }
}

export function recordMeasureEntry(entry: PerformanceMeasure): void {
  const parsed = parsePerfMeasureName(entry.name);
  if (!parsed || !state.enabled) {
    return;
  }
  if (parsed.category === "view") {
    return;
  }

  const durationMs = Number(entry.duration.toFixed(1));
  const meta = readSpanMeta(parsed.spanId);
  const ok = meta?.ok !== false;
  const details = isRecord(meta?.meta)
    ? meta.meta
    : undefined;
  if (parsed.category === "query") {
    recordClientPerfEvent(createPerfEvent({
      kind: "query_timing",
      label: parsed.label,
      durationMs,
      ok,
      meta: details,
    }));
    return;
  }

  recordClientPerfEvent(createPerfEvent({
    kind: "api_timing",
    label: parsed.label,
    durationMs,
    ok,
    method: typeof meta?.method === "string" ? meta.method : undefined,
    status: typeof meta?.status === "number" ? meta.status : undefined,
    meta: details,
  }));
}

export function recordNavigationEntry(entry: PerformanceNavigationTiming): void {
  if (!state.enabled) {
    return;
  }
  recordClientPerfEvent(createPerfEvent({
    kind: "view_transition",
    pathname: window.location.pathname,
    search: window.location.search,
    navigationType: entry.type,
  }));
}

export async function samplePreciseMemory(): Promise<number | null> {
  const perf = getMemoryPerformance();
  if (!perf?.measureUserAgentSpecificMemory) {
    return null;
  }
  const result = await perf.measureUserAgentSpecificMemory();
  return result.bytes;
}

export function toLongTaskEvent(entry: PerformanceEntry): LongTaskEvent | null {
  if (!state.enabled) {
    return null;
  }
  return createPerfEvent({
    kind: "long_task",
    durationMs: Number(entry.duration.toFixed(1)),
    name: entry.name || undefined,
  });
}

function recordSpanEvent(
  category: "api" | "query" | "view",
  label: string,
  meta: Record<string, unknown> | undefined,
  error: unknown,
): void {
  const spanId = findLastSpanId(category, label);
  if (!spanId) {
    return;
  }
  rememberSpanMeta(spanId, {
    ...meta,
    ok: !error,
  });
}

const spanMeta = new Map<string, Record<string, unknown>>();
const spanIdsByLabel = new Map<string, string>();

function rememberSpanMeta(spanId: string, meta: Record<string, unknown>): void {
  spanMeta.set(spanId, meta);
}

function readSpanMeta(spanId: string): Record<string, unknown> | undefined {
  const meta = spanMeta.get(spanId);
  spanMeta.delete(spanId);
  return meta;
}

function findLastSpanId(category: string, label: string): string | null {
  const key = `${category}:${label}`;
  return spanIdsByLabel.get(key) ?? null;
}

function createSpanId(): string {
  const spanId = Math.random().toString(36).slice(2, 10);
  return spanId;
}

function hasCoarseHeapSupport(): boolean {
  const perf = getMemoryPerformance();
  return Boolean(perf?.memory);
}

function hasPreciseHeapSupport(): boolean {
  const perf = getMemoryPerformance();
  return Boolean(perf?.measureUserAgentSpecificMemory);
}

function getMemoryPerformance(): MemoryLikePerformance | null {
  if (typeof performance === "undefined") {
    return null;
  }
  return performance as MemoryLikePerformance;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function scheduleFlush(): void {
  if (typeof window === "undefined" || state.flushTimer || !state.enabled) {
    return;
  }
  state.flushTimer = window.setTimeout(() => {
    state.flushTimer = null;
    void flushClientPerfEvents();
  }, FLUSH_DEBOUNCE_MS);
}

async function flushClientPerfEvents(): Promise<void> {
  if (state.flushInFlight || state.events.length === 0 || typeof window === "undefined") {
    return;
  }

  const pendingEvents = state.events.slice(state.flushCursor);
  const eventsToFlush = pendingEvents.slice(0, FLUSH_BATCH_SIZE);
  if (eventsToFlush.length === 0) {
    return;
  }
  const payload: ClientPerfBatchPayload = {
    schemaVersion: 1,
    events: eventsToFlush,
  };

  state.flushInFlight = fetch("/api/diagnostics/perf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).then(() => {
    state.flushCursor += eventsToFlush.length;
  }).catch(() => undefined).finally(() => {
    state.flushInFlight = null;
    if (state.flushCursor < state.events.length) {
      scheduleFlush();
    }
  });

  await state.flushInFlight;
}

function emit(): void {
  queueMicrotask(() => {
    for (const listener of state.listeners) {
      listener();
    }
  });
}

declare global {
  interface Window {
    __FOOLERY_DIAGNOSTICS__?: DiagnosticsHandle;
  }
}
