import assert from "node:assert/strict";
import { chromium } from "playwright";

const [url] = process.argv.slice(2);

if (!url) {
  throw new Error(
    "Usage: node scripts/test-terminal-rehydration-multicontext.mjs <url>",
  );
}

const STORAGE_KEY = "foolery:terminal-store";

async function postFixture(page, body) {
  const result = await page.evaluate(async (payload) => {
    const response = await fetch("/api/test/terminal-fixture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return {
      ok: response.ok,
      status: response.status,
      json: await response.json(),
    };
  }, body);

  assert.equal(result.ok, true, JSON.stringify(result.json));
  return result.json;
}

async function setPersistedTerminal(page, session) {
  await page.evaluate(({ storageKey, sessionData }) => {
    localStorage.setItem(storageKey, JSON.stringify({
      state: {
        terminals: [{
          sessionId: sessionData.id,
          beatId: sessionData.beatId,
          beatTitle: sessionData.beatTitle,
          repoPath: sessionData.repoPath,
          agentName: sessionData.agentName,
          agentModel: sessionData.agentModel,
          agentVersion: sessionData.agentVersion,
          agentCommand: sessionData.agentCommand,
          status: sessionData.status,
          startedAt: sessionData.startedAt,
        }],
        activeSessionId: sessionData.id,
        panelOpen: true,
        panelMinimized: false,
        panelHeight: 35,
      },
      version: 1,
    }));
  }, { storageKey: STORAGE_KEY, sessionData: session });
}

async function waitForStatus(page, status) {
  await page.locator(`[title="${status}"]`).waitFor();
}

async function waitForSessionTab(page, title) {
  await page
    .locator("button")
    .filter({ hasText: title })
    .first()
    .waitFor();
}

let browser;

try {
  browser = await chromium.launch();
} catch (error) {
  const message = error instanceof Error
    ? error.message
    : String(error);
  throw new Error(
    `${message}\nInstall Chromium with: bunx playwright install chromium`,
  );
}

try {
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await pageA.goto(url, { waitUntil: "domcontentloaded" });

  await postFixture(pageA, { action: "clear" });

  const firstSession = (await postFixture(pageA, {
    action: "create",
    id: "fixture-running-1",
    beatId: "fixture-beat-1",
    beatTitle: "Cross Browser Fixture 1",
    repoPath: process.cwd(),
    agentName: "Fixture Agent",
    agentModel: "fixture-model",
    agentCommand: "fixture-agent",
    startedAt: "2026-03-31T12:00:00.000Z",
  })).data;

  await setPersistedTerminal(pageA, firstSession);
  await pageA.reload({ waitUntil: "domcontentloaded" });
  await waitForSessionTab(pageA, "Cross Browser Fixture 1");
  await waitForStatus(pageA, "running");

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await pageB.goto(url, { waitUntil: "domcontentloaded" });
  await waitForSessionTab(pageB, "Cross Browser Fixture 1");
  await waitForStatus(pageB, "running");

  const terminateButton = pageB.getByTitle("Terminate");
  await terminateButton.waitFor();
  await terminateButton.click({ force: true });

  await pageB.waitForFunction(async () => {
    const response = await fetch("/api/test/terminal-fixture");
    const json = await response.json();
    return (json.data ?? []).every((session) => session.id !== "fixture-running-1");
  });

  const secondSession = (await postFixture(pageA, {
    action: "create",
    id: "fixture-running-2",
    beatId: "fixture-beat-2",
    beatTitle: "Cross Browser Fixture 2",
    repoPath: process.cwd(),
    agentName: "Fixture Agent",
    agentModel: "fixture-model",
    agentCommand: "fixture-agent",
    startedAt: "2026-03-31T12:01:00.000Z",
  })).data;

  await setPersistedTerminal(pageA, secondSession);
  await pageA.reload({ waitUntil: "domcontentloaded" });
  await waitForSessionTab(pageA, "Cross Browser Fixture 2");
  await waitForStatus(pageA, "running");

  const contextC = await browser.newContext();
  const pageC = await contextC.newPage();
  await pageC.goto(url, { waitUntil: "domcontentloaded" });
  await waitForSessionTab(pageC, "Cross Browser Fixture 2");
  await waitForStatus(pageC, "running");

  await postFixture(pageA, {
    action: "event",
    sessionId: "fixture-running-2",
    event: {
      type: "exit",
      data: "0",
      timestamp: Date.now(),
    },
  });

  await waitForStatus(pageA, "completed");
  await waitForStatus(pageC, "completed");
  await pageA.waitForFunction(async () => {
    const response = await fetch("/api/test/terminal-fixture");
    const json = await response.json();
    return (json.data ?? []).every((session) => session.id !== "fixture-running-2");
  });

  await postFixture(pageA, { action: "clear" });
  await contextA.close();
  await contextB.close();
  await contextC.close();
} finally {
  await browser?.close();
}
