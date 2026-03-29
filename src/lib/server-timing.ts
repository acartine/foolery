import { serverLog } from "@/lib/server-logger";

interface ServerMetric {
  name: string;
  durationMs: number;
}

interface ServerTimingConfig {
  route: string;
  slowMs?: number;
  context?: Record<string, unknown>;
}

interface ServerTimingTools {
  measure: <T>(
    name: string,
    run: () => Promise<T> | T,
  ) => Promise<T>;
}

export async function withServerTiming(
  config: ServerTimingConfig,
  handler: (tools: ServerTimingTools) => Promise<Response>,
): Promise<Response> {
  const metrics: ServerMetric[] = [];
  const startedAt = performance.now();

  const response = await handler({
    measure: async <T>(name: string, run: () => Promise<T> | T): Promise<T> => {
      const metricStartedAt = performance.now();
      try {
        return await run();
      } finally {
        metrics.push({
          name,
          durationMs: performance.now() - metricStartedAt,
        });
      }
    },
  });

  const totalDurationMs = performance.now() - startedAt;
  const headerValue = formatServerTimingHeader(metrics, totalDurationMs);
  response.headers.set("Server-Timing", headerValue);

  if (totalDurationMs >= (config.slowMs ?? 500)) {
    serverLog("warn", "api-perf", `${config.route} slow request`, {
      route: config.route,
      durationMs: roundMetric(totalDurationMs),
      metrics: metrics.map((metric) => ({
        name: metric.name,
        durationMs: roundMetric(metric.durationMs),
      })),
      ...config.context,
    });
  }

  return response;
}

function formatServerTimingHeader(
  metrics: ServerMetric[],
  totalDurationMs: number,
): string {
  const headerMetrics = [...metrics, {
    name: "total",
    durationMs: totalDurationMs,
  }];
  return headerMetrics
    .map((metric) => `${metric.name};dur=${roundMetric(metric.durationMs)}`)
    .join(", ");
}

function roundMetric(value: number): number {
  return Number(value.toFixed(1));
}
