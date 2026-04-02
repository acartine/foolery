import assert from "node:assert/strict";
import { chromium } from "playwright";

const [baseUrl] = process.argv.slice(2);

if (!baseUrl) {
  throw new Error(
    "Usage: node scripts/test-queue-pulldown-stability.mjs <base-url>",
  );
}

const PULLDOWN_SELECTOR = [
  "[data-slot='dropdown-menu-trigger']",
  "[data-slot='select-trigger']",
].join(", ");
const OPEN_CONTENT_SELECTOR = [
  "[data-slot='dropdown-menu-content'][data-state='open']",
  "[data-slot='select-content'][data-state='open']",
].join(", ");
const EXPECTED_MULTISELECT_COUNT = 3;
const MAX_SCROLL_DELTA = 0.5;
const MAX_RECT_DELTA = 1;

const repoFixtures = [
  {
    path: "/tmp/foolery-e2e-repo-a",
    name: "Fixture Repo A",
    memoryManagerType: "knots",
  },
  {
    path: "/tmp/foolery-e2e-repo-b",
    name: "Fixture Repo B",
    memoryManagerType: "knots",
  },
];

const beats = createQueuedBeats();

function nowIso() {
  return new Date().toISOString();
}

function makeBeat(overrides) {
  return {
    id: "foolery-fixture",
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

function createQueuedBeats() {
  return Array.from({ length: 18 }, (_entry, index) => {
    const repo = repoFixtures[index % repoFixtures.length];
    return makeBeat({
      id: `foolery-queue-${index + 1}`,
      title: `Queued fixture ${index + 1}`,
      priority: index % 5,
      profileId: "autopilot",
      type: index % 2 === 0 ? "work" : "bug",
      _repoPath: repo.path,
      _repoName: repo.name,
      _memoryManagerType: repo.memoryManagerType,
    });
  });
}

function jsonBody(data) {
  return JSON.stringify({ data });
}

function filterBeats(url) {
  const parsed = new URL(url);
  const state = parsed.searchParams.get("state");
  const repo = parsed.searchParams.get("_repo");
  const scope = parsed.searchParams.get("scope");
  const requiresHumanAction =
    parsed.searchParams.get("requiresHumanAction") === "true";

  if (requiresHumanAction) return [];

  return beats.filter((beat) => {
    if (state && beat.state !== state) return false;
    if (repo && beat._repoPath !== repo) return false;
    if (scope !== "all" && !repo && beat._repoPath !== repoFixtures[0].path) {
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

async function installApiMocks(page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/registry") {
      return fulfillJson(route, repoFixtures.map((repo) => ({
        ...repo,
        addedAt: nowIso(),
      })));
    }

    if (url.pathname === "/api/beats" && request.method() === "GET") {
      return fulfillJson(route, filterBeats(request.url()));
    }

    if (url.pathname === "/api/scope-refinement/status") {
      return fulfillJson(route, { completions: [] });
    }

    if (url.pathname === "/api/version") {
      return fulfillJson(route, {
        installedVersion: "0.8.0",
        latestVersion: "0.8.0",
        updateAvailable: false,
      });
    }

    if (url.pathname === "/api/diagnostics/perf") {
      return route.fulfill({ status: 204, body: "" });
    }

    await route.continue();
  });
}

async function waitForQueuesView(page) {
  await page.goto(
    `${baseUrl}/beats?view=queues&state=queued`,
    { waitUntil: "networkidle" },
  );
  await page.waitForSelector("[data-testid='beat-table-shell']");
  await page.waitForFunction(
    (expectedCount) =>
      document.querySelectorAll("[aria-label='Select row']").length >= expectedCount,
    EXPECTED_MULTISELECT_COUNT,
  );
}

async function enableMultiSelect(page) {
  const rowCheckboxes = page.locator("[aria-label='Select row']");
  for (let index = 0; index < EXPECTED_MULTISELECT_COUNT; index += 1) {
    await rowCheckboxes.nth(index).click();
  }
  await page.waitForFunction(
    () => document.body.textContent?.includes("3 selected") ?? false,
  );
}

async function setNonZeroScroll(page, top = 8) {
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.evaluate((nextTop) => {
    window.scrollTo({ top: nextTop, behavior: "instant" });
  }, top);
  await page.waitForFunction(() => window.scrollY > 0);
}

async function getPulldownDescriptors(page, edgeInset = 8) {
  return page.evaluate(({ selector, edgeInset: inset }) => {
    const isVisible = (element) => {
      const html = element;
      const rect = html.getBoundingClientRect();
      const style = window.getComputedStyle(html);
      return (
        rect.top >= inset
        && rect.bottom <= window.innerHeight - inset
        && rect.width > 0
        && rect.height > 0
        && style.display !== "none"
        && style.visibility !== "hidden"
      );
    };

    const elements = Array.from(document.querySelectorAll(selector))
      .filter((element) =>
        element instanceof HTMLElement
        && !element.hasAttribute("disabled")
        && element.getAttribute("aria-disabled") !== "true"
        && isVisible(element));

    return elements.map((element, index) => {
      const html = element;
      if (!(html instanceof HTMLElement)) {
        throw new Error(`Pulldown trigger ${index} is not an HTMLElement`);
      }
      const label = [
        html.getAttribute("title"),
        html.getAttribute("aria-label"),
        html.textContent?.replace(/\s+/g, " ").trim(),
      ].find((value) => value && value.length > 0) ?? `pulldown-${index}`;
      return { index, label };
    });
  }, { selector: PULLDOWN_SELECTOR, edgeInset });
}

async function getPulldownHandles(page, edgeInset = 8) {
  const handles = await page.$$(PULLDOWN_SELECTOR);
  const filtered = [];

  for (const handle of handles) {
    const keep = await handle.evaluate((element, inset) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        !element.hasAttribute("disabled")
        && element.getAttribute("aria-disabled") !== "true"
        && rect.top >= inset
        && rect.bottom <= window.innerHeight - inset
        && rect.width > 0
        && rect.height > 0
        && style.display !== "none"
        && style.visibility !== "hidden"
      );
    }, edgeInset);
    if (keep) filtered.push(handle);
  }

  return filtered;
}

async function captureMetrics(page, index) {
  return page.evaluate((args) => {
    const pulldowns = Array.from(
      document.querySelectorAll(args.selector),
    );
    const trigger = pulldowns[args.index];
    const pageShell = document.querySelector("[data-testid='beats-page']");
    const filterShell = document.querySelector("[data-testid='beats-filter-shell']");
    const tableShell = document.querySelector("[data-testid='beat-table-shell']");

    if (!(trigger instanceof HTMLElement)) {
      throw new Error(`Missing pulldown trigger at index ${args.index}`);
    }
    if (!(pageShell instanceof HTMLElement)) {
      throw new Error("Missing [data-testid='beats-page']");
    }
    if (!(filterShell instanceof HTMLElement)) {
      throw new Error("Missing [data-testid='beats-filter-shell']");
    }
    if (!(tableShell instanceof HTMLElement)) {
      throw new Error("Missing [data-testid='beat-table-shell']");
    }

    const toRect = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    };

    return {
      scrollY: window.scrollY,
      trigger: toRect(trigger),
      page: toRect(pageShell),
      filters: toRect(filterShell),
      table: toRect(tableShell),
    };
  }, { index, selector: PULLDOWN_SELECTOR });
}

function diffRect(before, after) {
  return Math.max(
    Math.abs(before.top - after.top),
    Math.abs(before.left - after.left),
    Math.abs(before.width - after.width),
    Math.abs(before.height - after.height),
  );
}

function assertStableMetrics(label, before, after, phase) {
  const scrollDelta = Math.abs(before.scrollY - after.scrollY);
  assert(
    scrollDelta <= MAX_SCROLL_DELTA,
    `${label} changed scrollY during ${phase}: ${before.scrollY} -> ${after.scrollY}`,
  );

  const rectDiffs = {
    trigger: diffRect(before.trigger, after.trigger),
    page: diffRect(before.page, after.page),
    filters: diffRect(before.filters, after.filters),
    table: diffRect(before.table, after.table),
  };

  for (const [rectName, delta] of Object.entries(rectDiffs)) {
    assert(
      delta <= MAX_RECT_DELTA,
      `${label} moved ${rectName} during ${phase} by ${delta.toFixed(2)}px`,
    );
  }

  return { scrollDelta, rectDiffs };
}

async function waitForPulldownState(page, shouldBeOpen, timeout = 1_000) {
  try {
    await page.waitForFunction(
      ({ selector, shouldBeOpen: open }) =>
        (document.querySelector(selector) !== null) === open,
      { selector: OPEN_CONTENT_SELECTOR, shouldBeOpen },
      { timeout },
    );
    return true;
  } catch {
    return false;
  }
}

async function openPulldown(page, handle, label) {
  const slot = await handle.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error("Pulldown trigger is not an HTMLElement");
    }
    return element.getAttribute("data-slot");
  });

  await handle.click({ force: true, timeout: 1_000 });
  if (await waitForPulldownState(page, true)) {
    return slot ?? label;
  }

  for (const key of ["Enter", "ArrowDown", "Space"]) {
    await handle.press(key);
    if (await waitForPulldownState(page, true)) return slot ?? label;
  }

  throw new Error(`Failed to open pulldown: ${label}`);
}

async function closePulldown(page) {
  await page.keyboard.press("Escape");
  const closed = await waitForPulldownState(page, false);
  assert(closed, "Pulldown did not close after Escape");
}

async function verifyPulldown(page, descriptor, edgeInset = 8) {
  const handles = await getPulldownHandles(page, edgeInset);
  const handle = handles[descriptor.index];
  assert(handle, `Missing pulldown handle for ${descriptor.label}`);
  const before = await captureMetrics(page, descriptor.index);
  console.log(`Opening pulldown: ${descriptor.label}`);
  await openPulldown(page, handle, descriptor.label);
  const opened = await captureMetrics(page, descriptor.index);
  console.log(`Opened pulldown: ${descriptor.label}`);
  const openMetrics = assertStableMetrics(
    descriptor.label,
    before,
    opened,
    "open",
  );
  await closePulldown(page);
  console.log(`Closed pulldown: ${descriptor.label}`);
  const closed = await captureMetrics(page, descriptor.index);
  const closeMetrics = assertStableMetrics(
    descriptor.label,
    before,
    closed,
    "close",
  );
  return {
    label: descriptor.label,
    scrollY: before.scrollY,
    openMetrics,
    closeMetrics,
  };
}

function summarize(results) {
  return results.reduce((summary, result) => {
    const deltas = [
      result.openMetrics.scrollDelta,
      result.closeMetrics.scrollDelta,
      ...Object.values(result.openMetrics.rectDiffs),
      ...Object.values(result.closeMetrics.rectDiffs),
    ];
    return {
      triggerCount: summary.triggerCount + 1,
      maxDelta: Math.max(summary.maxDelta, ...deltas),
      minScrollY: Math.min(summary.minScrollY, result.scrollY),
    };
  }, {
    triggerCount: 0,
    maxDelta: 0,
    minScrollY: Number.POSITIVE_INFINITY,
  });
}

let browser;

try {
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 420 },
  });

  await installApiMocks(page);
  console.log("Loaded API mocks");
  await waitForQueuesView(page);
  console.log("Queues view loaded");
  await enableMultiSelect(page);
  console.log("Multi-select enabled");
  await setNonZeroScroll(page, 1);
  console.log("Non-zero scroll set");

  const repoDescriptors = await getPulldownDescriptors(page, 0);
  const repoHandles = await getPulldownHandles(page, 0);
  assert.equal(
    repoHandles.length,
    repoDescriptors.length,
    "Repo pulldown descriptor count did not match handle count",
  );
  const repoSwitcher = repoDescriptors.find(
    (descriptor) => descriptor.label === "Switch repository",
  );
  assert(repoSwitcher, "Expected the repository pulldown to be visible");

  await setNonZeroScroll(page, 8);

  const descriptors = await getPulldownDescriptors(page);
  const filteredHandles = await getPulldownHandles(page);
  assert.equal(
    filteredHandles.length,
    descriptors.length,
    "Pulldown descriptor count did not match handle count",
  );

  const results = [];
  console.log(`Verifying pulldown: ${repoSwitcher.label}`);
  results.push(await verifyPulldown(page, repoSwitcher, 0));
  for (const descriptor of descriptors) {
    if (descriptor.label === "Switch repository") continue;
    console.log(`Verifying pulldown: ${descriptor.label}`);
    results.push(await verifyPulldown(page, descriptor));
  }

  const summary = summarize(results);
  assert(summary.triggerCount > 0, "Expected at least one pulldown to be verified");
  assert(
    summary.minScrollY > 0,
    `Expected non-zero scroll validation, got min scrollY ${summary.minScrollY}`,
  );

  console.log(JSON.stringify({
    triggerCount: summary.triggerCount,
    minScrollY: summary.minScrollY,
    maxDeltaPx: Number(summary.maxDelta.toFixed(3)),
    labels: results.map((result) => result.label),
  }, null, 2));
} catch (error) {
  throw error;
} finally {
  await browser?.close();
}
