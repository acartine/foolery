import { spawn } from "node:child_process";
import fsSync from "node:fs";
import path from "node:path";
import { BlockedError, log, rootDir } from "./test-cli-approvals-manual-core.mjs";

export function spawnDevServer(provider, options, run) {
  if (options.baseUrl) {
    return {
      baseUrl: options.baseUrl.replace(/\/$/, ""),
      stop: async () => {},
    };
  }

  const logPath = path.join(run.runDir, "dev.log");
  const out = fsSync.openSync(logPath, "a");
  const child = spawn(
    "bun",
    ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(options.port)],
    {
      cwd: rootDir,
      env: { ...process.env, ...run.env },
      stdio: ["ignore", out, out],
    },
  );
  const baseUrl = `http://127.0.0.1:${options.port}`;
  log(provider, `Started dev server on ${baseUrl}; log: ${logPath}`);
  return {
    baseUrl,
    logPath,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 4_000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    },
    exited: () => child.exitCode !== null || child.signalCode !== null,
  };
}

export async function waitForServer(server, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (server.exited?.()) {
      throw new Error(`Foolery dev server exited early. Check ${server.logPath}.`);
    }
    try {
      const response = await fetch(`${server.baseUrl}/beats`);
      if (response.ok) return;
    } catch {
      // Retry until timeout.
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for Foolery server at ${server.baseUrl}.`);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startTerminalSession(baseUrl, beatId, repo, prompt) {
  const response = await fetch(`${baseUrl}/api/terminal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ beatId, _repo: repo, prompt }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error ?? `POST /api/terminal failed: ${response.status}`);
  }
  const session = json.data;
  if (!session || typeof session.id !== "string") {
    throw new Error(`Unexpected terminal response: ${JSON.stringify(json)}`);
  }
  return session.id;
}

export async function waitForSessionEvent(
  baseUrl,
  sessionId,
  timeoutMs,
  predicate,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const seen = [];
  try {
    const response = await fetch(`${baseUrl}/api/terminal/${sessionId}`, {
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`SSE connection failed: ${response.status}`);
    }
    return await readSseUntil(response.body, seen, predicate);
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`Timed out waiting for session event. Last events: ${summarize(seen)}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readSseUntil(body, seen, predicate) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const match = await drainFrames(reader, seen, buffer, predicate);
    buffer = match.buffer;
    if (match.event) return match.event;
  }
  throw new Error(`SSE stream ended before expected event. Last events: ${summarize(seen)}`);
}

async function drainFrames(reader, seen, initialBuffer, predicate) {
  let buffer = initialBuffer;
  let boundary = buffer.indexOf("\n\n");
  while (boundary >= 0) {
    const frame = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    const event = parseSseFrame(frame);
    if (event) {
      seen.push(event);
      if (seen.length > 25) seen.shift();
      if (predicate(event)) {
        await reader.cancel();
        return { buffer, event };
      }
    }
    boundary = buffer.indexOf("\n\n");
  }
  return { buffer, event: null };
}

function parseSseFrame(frame) {
  const dataLines = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  try {
    return JSON.parse(dataLines.join("\n"));
  } catch {
    return null;
  }
}

function summarize(events) {
  return events
    .map((event) => `${event.type}:${String(event.data ?? "").slice(0, 120)}`)
    .join(" | ");
}

export async function verifyAndApproveInBrowser(baseUrl, repo, sessionId, provider) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const url = `${baseUrl}/beats?view=finalcut&tab=approvals&repo=${
      encodeURIComponent(repo)
    }`;
    await page.goto(url, { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText({ timeout: 15_000 });
    if (!body.includes(sessionId) || !body.toLowerCase().includes(provider)) {
      throw new Error(
        `Approvals tab did not show provider/session context for ${provider}.`,
      );
    }
    const approve = page
      .getByRole("button", { name: /^(Approve once|Allow once|Approve)$/i })
      .first();
    if ((await approve.count()) === 0) {
      throw new BlockedError("Foolery approval action UI is not wired.");
    }
    await approve.click();
  } finally {
    await browser.close();
  }
}

export async function terminateSession(baseUrl, sessionId) {
  const url = `${baseUrl}/api/terminal/${sessionId}/terminate`;
  const response = await fetch(url, { method: "POST" });
  if (response.ok) return;
  await fetch(`${baseUrl}/api/terminal/${sessionId}/kill`, { method: "POST" })
    .catch(() => {});
}
