#!/usr/bin/env node
import { chromium } from "playwright";

const DEFAULT_BASE_URL = "http://manhattan:3210";
const DEFAULT_SECONDS = 30;
const REQUEST_WARN_MS = 2_000;

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function targetUrl() {
  const explicitUrl = readArg("--url");
  if (explicitUrl) return explicitUrl;
  const base = process.env.FOOLERY_BASE_URL ?? DEFAULT_BASE_URL;
  if (base.includes("/beats")) return base;
  return `${base.replace(/\/$/, "")}/beats?diagnostics=1`;
}

function durationMs() {
  const raw = readArg("--seconds") ?? process.env.FOOLERY_TERMINAL_PROBE_SECONDS;
  const parsed = Number(raw ?? DEFAULT_SECONDS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : DEFAULT_SECONDS * 1000;
}

function installBrowserProbe() {
  const NativeEventSource = window.EventSource;
  const stats = {
    sources: [],
    messages: 0,
    bytes: 0,
    byUrl: {},
    longTasks: [],
  };
  window.__FOOLERY_EVENTSOURCE_PROBE__ = stats;
  window.EventSource = new Proxy(NativeEventSource, {
    construct(target, args) {
      const source = Reflect.construct(target, args);
      const url = String(args[0]);
      stats.sources.push({ url, createdAtMs: performance.now() });
      source.addEventListener("message", (event) => {
        const bytes = typeof event.data === "string" ? event.data.length : 0;
        stats.messages += 1;
        stats.bytes += bytes;
        stats.byUrl[url] ??= { messages: 0, bytes: 0 };
        stats.byUrl[url].messages += 1;
        stats.byUrl[url].bytes += bytes;
      });
      return source;
    },
  });
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        stats.longTasks.push({
          startTime: entry.startTime,
          duration: entry.duration,
        });
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    // Some browsers or contexts do not expose longtask entries.
  }
}

function terminalStreamKind(url) {
  const parsed = new URL(url);
  if (!parsed.pathname.startsWith("/api/terminal")) return "other";
  if (parsed.pathname === "/api/terminal/events") return "multiplex";
  if (/^\/api\/terminal\/[^/]+$/.test(parsed.pathname)) return "per-session";
  return "other-terminal";
}

function summarizeNetwork(requests, responses, finished) {
  const terminalStreams = [];
  const apiDurations = [];
  for (const response of responses.values()) {
    const request = requests.get(response.requestId);
    const finish = finished.get(response.requestId);
    const durationMs = finish && request
      ? (finish.timestamp - request.timestamp) * 1000
      : null;
    const kind = terminalStreamKind(response.url);
    if (isEventStreamMime(response.mimeType) && kind !== "other") {
      terminalStreams.push({ ...response, kind, durationMs });
    }
    if (isOrdinaryUiRequest(response.url, response.mimeType) && durationMs !== null) {
      apiDurations.push({ url: response.url, protocol: response.protocol, durationMs });
    }
  }
  return { terminalStreams, apiDurations };
}

function isEventStreamMime(mimeType) {
  return mimeType.toLowerCase().includes("text/event-stream");
}

function isOrdinaryUiRequest(url, mimeType) {
  const pathname = new URL(url).pathname;
  if (isEventStreamMime(mimeType)) return false;
  return pathname === "/api/beats" || pathname === "/api/terminal";
}

function summarizeProtocols(terminalStreams) {
  return terminalStreams.reduce((acc, stream) => {
    acc[stream.protocol] = (acc[stream.protocol] ?? 0) + 1;
    return acc;
  }, {});
}

async function collectPageStats(page) {
  return page.evaluate(() => ({
    eventSourceProbe: window.__FOOLERY_EVENTSOURCE_PROBE__ ?? null,
    terminalConnectionStats:
      window.__FOOLERY_TERMINAL_CONNECTION_STATS__?.() ?? null,
    resources: performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.includes("/api/"))
      .map((entry) => ({
        name: entry.name,
        duration: entry.duration,
        transferSize: entry.transferSize,
      })),
  }));
}

async function main() {
  const url = targetUrl();
  const probeMs = durationMs();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(installBrowserProbe);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const requests = new Map();
  const responses = new Map();
  const finished = new Map();

  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", (event) => {
    requests.set(event.requestId, {
      requestId: event.requestId,
      url: event.request.url,
      timestamp: event.timestamp,
    });
  });
  cdp.on("Network.responseReceived", (event) => {
    responses.set(event.requestId, {
      requestId: event.requestId,
      url: event.response.url,
      status: event.response.status,
      mimeType: event.response.mimeType,
      protocol: event.response.protocol,
      timestamp: event.timestamp,
    });
  });
  cdp.on("Network.loadingFinished", (event) => {
    finished.set(event.requestId, { timestamp: event.timestamp });
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(probeMs);
  const pageStats = await collectPageStats(page);
  await browser.close();

  const network = summarizeNetwork(requests, responses, finished);
  const perSessionStreams = network.terminalStreams
    .filter((stream) => stream.kind === "per-session");
  const maxApiDurationMs = Math.max(
    0,
    ...network.apiDurations.map((request) => request.durationMs),
  );
  const report = {
    url,
    probeSeconds: probeMs / 1000,
    terminalStreamCount: network.terminalStreams.length,
    perSessionTerminalStreamCount: perSessionStreams.length,
    protocols: summarizeProtocols(network.terminalStreams),
    eventSourceCount: pageStats.eventSourceProbe?.sources.length ?? 0,
    eventSources: pageStats.eventSourceProbe?.sources ?? [],
    eventSourceByUrl: pageStats.eventSourceProbe?.byUrl ?? {},
    messageRatePerSecond:
      (pageStats.eventSourceProbe?.messages ?? 0) / (probeMs / 1000),
    eventSourceBytes: pageStats.eventSourceProbe?.bytes ?? 0,
    terminalStreams: network.terminalStreams,
    apiDurations: network.apiDurations,
    maxApiDurationMs,
    longTasks: pageStats.eventSourceProbe?.longTasks ?? [],
    terminalConnectionStats: pageStats.terminalConnectionStats,
  };

  console.log(JSON.stringify(report, null, 2));

  if (perSessionStreams.length > 0 || network.terminalStreams.length > 1) {
    process.exitCode = 1;
  }
  if (maxApiDurationMs > REQUEST_WARN_MS) {
    console.warn(
      `warning: ordinary API request exceeded ${REQUEST_WARN_MS} ms`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
