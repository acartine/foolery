export const PERF_SCHEMA_VERSION = 1;

export type ClientPerfEventKind =
  | "heap_sample"
  | "long_task"
  | "render_commit"
  | "query_timing"
  | "api_timing"
  | "view_transition"
  | "gc_suspect";

interface ClientPerfEventBase {
  id: string;
  ts: string;
  schemaVersion: number;
  kind: ClientPerfEventKind;
}

export interface HeapSampleEvent extends ClientPerfEventBase {
  kind: "heap_sample";
  usedJSHeapSize: number;
  totalJSHeapSize?: number;
  jsHeapSizeLimit?: number;
  route?: string;
}

export interface LongTaskEvent extends ClientPerfEventBase {
  kind: "long_task";
  durationMs: number;
  name?: string;
}

export interface RenderCommitEvent extends ClientPerfEventBase {
  kind: "render_commit";
  profilerId: string;
  phase: "mount" | "update" | "nested-update";
  actualDurationMs: number;
  baseDurationMs: number;
  startTimeMs: number;
  commitTimeMs: number;
  interactionLabel?: string;
  beatCount?: number;
}

export interface QueryTimingEvent extends ClientPerfEventBase {
  kind: "query_timing";
  label: string;
  durationMs: number;
  ok: boolean;
  meta?: Record<string, unknown>;
}

export interface ApiTimingEvent extends ClientPerfEventBase {
  kind: "api_timing";
  label: string;
  durationMs: number;
  ok: boolean;
  method?: string;
  status?: number;
  meta?: Record<string, unknown>;
}

export interface ViewTransitionEvent extends ClientPerfEventBase {
  kind: "view_transition";
  pathname: string;
  search: string;
  navigationType?: string;
}

export interface GcSuspectEvent extends ClientPerfEventBase {
  kind: "gc_suspect";
  beforeUsedJSHeapSize: number;
  afterUsedJSHeapSize: number;
  dropBytes: number;
  dropRatio: number;
}

export type ClientPerfEvent =
  | HeapSampleEvent
  | LongTaskEvent
  | RenderCommitEvent
  | QueryTimingEvent
  | ApiTimingEvent
  | ViewTransitionEvent
  | GcSuspectEvent;

export type NewClientPerfEvent = Omit<
  ClientPerfEvent,
  "id" | "ts" | "schemaVersion"
>;

export interface ClientPerfBatchPayload {
  schemaVersion: number;
  events: ClientPerfEvent[];
}

export interface PerfSink {
  flush: (events: ClientPerfEvent[]) => Promise<void>;
}

export interface DiagnosticsSummary {
  totalEvents: number;
  counts: Record<ClientPerfEventKind, number>;
  latestHeapSample: HeapSampleEvent | null;
  latestGcSuspect: GcSuspectEvent | null;
  latestViewTransition: ViewTransitionEvent | null;
  latestLongTask: LongTaskEvent | null;
  latestQueryTiming: QueryTimingEvent | null;
  latestApiTiming: ApiTimingEvent | null;
  totalLongTaskMs: number;
  totalRenderCommitMs: number;
}

const MEASURE_PREFIX = "foolery";

export function buildPerfMeasureName(
  category: "api" | "query" | "view",
  label: string,
  spanId: string,
): string {
  return `${MEASURE_PREFIX}|${category}|${encodeURIComponent(label)}|${spanId}`;
}

export function parsePerfMeasureName(
  name: string,
): {
  category: "api" | "query" | "view";
  label: string;
  spanId: string;
} | null {
  const parts = name.split("|");
  if (parts.length !== 4 || parts[0] !== MEASURE_PREFIX) {
    return null;
  }
  const category = parts[1];
  if (category !== "api" && category !== "query" && category !== "view") {
    return null;
  }
  return {
    category,
    label: decodeURIComponent(parts[2] ?? ""),
    spanId: parts[3] ?? "",
  };
}

export function createPerfEvent<T extends NewClientPerfEvent>(
  event: T,
): T & Pick<ClientPerfEventBase, "id" | "ts" | "schemaVersion"> {
  return {
    ...event,
    id: createPerfId(),
    ts: new Date().toISOString(),
    schemaVersion: PERF_SCHEMA_VERSION,
  };
}

export function summarizeClientPerfEvents(
  events: ClientPerfEvent[],
): DiagnosticsSummary {
  const counts: DiagnosticsSummary["counts"] = {
    heap_sample: 0,
    long_task: 0,
    render_commit: 0,
    query_timing: 0,
    api_timing: 0,
    view_transition: 0,
    gc_suspect: 0,
  };

  let latestHeapSample: HeapSampleEvent | null = null;
  let latestGcSuspect: GcSuspectEvent | null = null;
  let latestViewTransition: ViewTransitionEvent | null = null;
  let latestLongTask: LongTaskEvent | null = null;
  let latestQueryTiming: QueryTimingEvent | null = null;
  let latestApiTiming: ApiTimingEvent | null = null;
  let totalLongTaskMs = 0;
  let totalRenderCommitMs = 0;

  for (const event of events) {
    counts[event.kind] += 1;
    if (event.kind === "heap_sample") {
      latestHeapSample = event;
    } else if (event.kind === "gc_suspect") {
      latestGcSuspect = event;
    } else if (event.kind === "view_transition") {
      latestViewTransition = event;
    } else if (event.kind === "long_task") {
      latestLongTask = event;
      totalLongTaskMs += event.durationMs;
    } else if (event.kind === "query_timing") {
      latestQueryTiming = event;
    } else if (event.kind === "api_timing") {
      latestApiTiming = event;
    } else if (event.kind === "render_commit") {
      totalRenderCommitMs += event.actualDurationMs;
    }
  }

  return {
    totalEvents: events.length,
    counts,
    latestHeapSample,
    latestGcSuspect,
    latestViewTransition,
    latestLongTask,
    latestQueryTiming,
    latestApiTiming,
    totalLongTaskMs,
    totalRenderCommitMs,
  };
}

function createPerfId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `perf_${Date.now().toString(36)}_${random}`;
}
