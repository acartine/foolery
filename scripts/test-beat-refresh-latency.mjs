import assert from "node:assert/strict";
import { chromium } from "playwright";

const [baseUrl] = process.argv.slice(2);

if (!baseUrl) {
  throw new Error(
    "Usage: node scripts/test-beat-refresh-latency.mjs <base-url>",
  );
}

const repoPath = "/tmp/foolery-e2e-repo";
const fixtureSessionId = "fixture-running-1";
const createdTitle = "Latency test created beat";
const queuedBeatTitle = "Queued baseline";
const activeBeatTitle = "Active baseline";
const updatedActiveBeatTitle = "Active baseline updated";

let nextBeatId = 3;
let beats = [
  makeBeat({
    id: "foolery-queue-1",
    title: queuedBeatTitle,
    state: "queued",
    priority: 2,
  }),
  makeBeat({
    id: "foolery-active-1",
    title: activeBeatTitle,
    state: "in_action",
    priority: 3,
  }),
];

function nowIso() {
  return new Date().toISOString();
}

function makeBeat(overrides) {
  return {
    id: "foolery-beat",
    aliases: [],
    title: "Fixture beat",
    description: "",
    acceptance: "",
    type: "work",
    state: "queued",
    priority: 2,
    labels: [],
    created: nowIso(),
    updated: nowIso(),
    ...overrides,
  };
}

function jsonBody(data) {
  return JSON.stringify({ data });
}

function isBeatListRequest(url, method) {
  const parsed = new URL(url);
  return parsed.pathname === "/api/beats" && method === "GET";
}

function listBeats(url) {
  const parsed = new URL(url);
  const state = parsed.searchParams.get("state");
  const search = parsed.searchParams.get("q");
  return beats.filter((beat) => {
    if (state && beat.state !== state) return false;
    if (
      search &&
      !beat.title.toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  });
}

async function fulfillJson(route, data, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: jsonBody(data),
  });
}

async function createFixtureSession() {
  const response = await fetch(
    `${baseUrl}/api/test/terminal-fixture`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        id: fixtureSessionId,
        beatId: "foolery-active-1",
        beatTitle: activeBeatTitle,
        repoPath,
        agentName: "Fixture Agent",
        agentModel: "fixture-model",
        agentVersion: "1.0",
        agentCommand: "fixture-agent",
        startedAt: nowIso(),
      }),
    },
  );
  assert.equal(
    response.ok,
    true,
    "failed to create fixture terminal session",
  );
}

async function clearFixtureSessions() {
  await fetch(`${baseUrl}/api/test/terminal-fixture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "clear" }),
  });
}

function terminalStoreSeed() {
  return {
    state: {
      terminals: [
        {
          sessionId: fixtureSessionId,
          beatId: "foolery-active-1",
          beatTitle: activeBeatTitle,
          repoPath,
          agentName: "Fixture Agent",
          agentModel: "fixture-model",
          agentVersion: "1.0",
          agentCommand: "fixture-agent",
          status: "running",
          startedAt: nowIso(),
        },
      ],
      activeSessionId: fixtureSessionId,
      panelOpen: true,
      panelMinimized: false,
      panelHeight: 35,
    },
    version: 1,
  };
}

async function installApiMocks(page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/registry") {
      return fulfillJson(route, [
        {
          path: repoPath,
          name: "Fixture Repo",
          addedAt: nowIso(),
          memoryManagerType: "knots",
        },
      ]);
    }

    if (url.pathname === "/api/settings") {
      return fulfillJson(route, {
        defaults: {
          profileId: "autopilot",
          interactiveSessionTimeoutMinutes: 10,
        },
      });
    }

    if (url.pathname === "/api/workflows") {
      return fulfillJson(route, [
        {
          id: "autopilot",
          backingWorkflowId: "autopilot",
          label: "Autopilot",
          mode: "coarse_human_gated",
          initialState: "queued",
          states: ["queued", "in_action", "shipped"],
          terminalStates: ["shipped"],
          finalCutState: null,
          retakeState: "queued",
          promptProfileId: "autopilot",
          profileId: "autopilot",
          queueStates: ["queued"],
          actionStates: ["in_action"],
        },
      ]);
    }

    if (url.pathname === "/api/scope-refinement/status") {
      return fulfillJson(route, { completions: [] });
    }

    if (url.pathname === "/api/beats" && request.method() === "GET") {
      return fulfillJson(route, listBeats(request.url()));
    }

    if (url.pathname === "/api/beats" && request.method() === "POST") {
      const body = JSON.parse(request.postData() ?? "{}");
      const beatId = `foolery-created-${nextBeatId}`;
      nextBeatId += 1;
      beats = [
        makeBeat({
          id: beatId,
          title: body.title ?? createdTitle,
          description: body.description ?? "",
          acceptance: body.acceptance ?? "",
          type: body.type ?? "work",
          state: "queued",
          priority: body.priority ?? 2,
          labels: Array.isArray(body.labels) ? body.labels : [],
          profileId: body.profileId ?? "autopilot",
        }),
        ...beats,
      ];
      return fulfillJson(route, { id: beatId }, 201);
    }

    if (
      url.pathname.startsWith("/api/beats/") &&
      request.method() === "PATCH"
    ) {
      const beatId = url.pathname.split("/").pop();
      const body = JSON.parse(request.postData() ?? "{}");
      const index = beats.findIndex((beat) => beat.id === beatId);
      if (index === -1) {
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "Beat not found" }),
        });
      }

      const { _repo, ...fields } = body;
      void _repo;
      beats[index] = {
        ...beats[index],
        ...fields,
        updated: nowIso(),
      };
      return fulfillJson(route, null);
    }

    await route.continue();
  });
}

async function waitForRefresh(page, action, label) {
  const startedAt = Date.now();
  const refresh = page.waitForResponse(
    (response) =>
      isBeatListRequest(
        response.url(),
        response.request().method(),
      ),
    { timeout: 1_000 },
  );

  await action();
  await refresh;

  const elapsedMs = Date.now() - startedAt;
  assert.ok(
    elapsedMs < 1_000,
    `${label} refresh took ${elapsedMs}ms`,
  );
  return elapsedMs;
}

async function waitForRow(page, title) {
  await page.locator("tr").filter({
    hasText: title,
  }).first().waitFor({ timeout: 1_000 });
}

async function verifyQueuedCreate(page) {
  await page.goto(
    `${baseUrl}/beats?repo=${encodeURIComponent(repoPath)}&view=queues&state=queued`,
    { waitUntil: "domcontentloaded" },
  );
  await waitForRow(page, queuedBeatTitle);
  await page.getByTitle(
    "Create new beat (Shift+N)",
  ).click();
  await page.getByPlaceholder(
    "Beat title",
  ).fill(createdTitle);

  const createLatencyMs = await waitForRefresh(
    page,
    async () => {
      await page.getByRole("button", {
        name: "Done",
      }).click();
    },
    "create beat",
  );

  await waitForRow(page, createdTitle);
  return createLatencyMs;
}

async function verifyActiveUpdate(page) {
  await page.goto(
    `${baseUrl}/beats?repo=${encodeURIComponent(repoPath)}&view=active&state=in_action`,
    { waitUntil: "domcontentloaded" },
  );
  await waitForRow(page, activeBeatTitle);
  const row = page.locator("tr").filter({
    hasText: activeBeatTitle,
  }).first();
  await row.getByText(activeBeatTitle).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 1_000 });
  await dialog.getByText(activeBeatTitle).click();
  const titleInput = dialog.locator("input").first();
  await titleInput.fill(updatedActiveBeatTitle);

  const updateLatencyMs = await waitForRefresh(
    page,
    async () => {
      await titleInput.press("Enter");
    },
    "update beat title",
  );

  await page.waitForFunction((title) => {
    const rows = Array.from(
      document.querySelectorAll("tr"),
    );
    return rows.some((row) => {
      const text = row.textContent ?? "";
      return text.includes(title);
    });
  }, updatedActiveBeatTitle, { timeout: 1_000 });

  return updateLatencyMs;
}

async function verifyBackgroundExitNoRefresh(page, beatListResponses) {
  const startedAt = Date.now();
  const response = await fetch(
    `${baseUrl}/api/test/terminal-fixture`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "event",
        sessionId: fixtureSessionId,
        event: {
          type: "exit",
          data: "0",
          timestamp: Date.now(),
        },
      }),
    },
  );
  assert.equal(
    response.ok,
    true,
    "failed to emit fixture exit event",
  );

  await page.waitForFunction((sessionId) => {
    const raw = window.localStorage.getItem(
      "foolery:terminal-store",
    );
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const terminals = parsed?.state?.terminals ?? [];
    return terminals.some((terminal) =>
      terminal.sessionId === sessionId &&
      terminal.status === "completed",
    );
  }, fixtureSessionId, { timeout: 1_000 });

  await page.waitForTimeout(1_100);

  const unexpectedRefresh = beatListResponses.some(
    (timestamp) => timestamp >= startedAt,
  );
  assert.equal(
    unexpectedRefresh,
    false,
    "background session exit triggered an immediate beat refresh",
  );
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
  await clearFixtureSessions();
  await createFixtureSession();

  const page = await browser.newPage();
  const beatListResponses = [];
  page.on("response", (response) => {
    if (
      isBeatListRequest(
        response.url(),
        response.request().method(),
      )
    ) {
      beatListResponses.push(Date.now());
    }
  });

  await page.addInitScript(({ repo, store }) => {
    window.localStorage.setItem(
      "foolery:lastRepo",
      repo,
    );
    window.localStorage.setItem(
      "foolery:terminal-store",
      JSON.stringify(store),
    );
  }, {
    repo: repoPath,
    store: terminalStoreSeed(),
  });

  await installApiMocks(page);

  const terminalStreamReady = page.waitForRequest(
    (request) =>
      request.url().includes(
        `/api/terminal/${fixtureSessionId}`,
      ) && request.method() === "GET",
    { timeout: 1_000 },
  );
  const createLatencyMs =
    await verifyQueuedCreate(page);
  await terminalStreamReady;
  beatListResponses.length = 0;

  const updateLatencyMs =
    await verifyActiveUpdate(page);
  beatListResponses.length = 0;

  await verifyBackgroundExitNoRefresh(
    page,
    beatListResponses,
  );

  console.log(
    JSON.stringify({
      createLatencyMs,
      updateLatencyMs,
      backgroundImmediateRefresh: false,
    }),
  );
} finally {
  await clearFixtureSessions();
  await browser?.close();
}
