import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const [url, settingsFile] = process.argv.slice(2);

if (!url || !settingsFile) {
  throw new Error(
    "Usage: node scripts/test-copilot-settings-ui.mjs <url> <settings-file>",
  );
}

async function fetchJson(page, path) {
  return await page.evaluate(async (targetPath) => {
    const res = await fetch(targetPath);
    return await res.json();
  }, path);
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
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });

  await page.getByTitle("Settings").waitFor();
  await page.getByTitle("Settings").click();
  await page.getByRole("tab", { name: "Agents" }).click();
  await page.getByRole("button", { name: "Scan" }).click();

  const scanResults = page
    .getByText("Scan Results")
    .locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
  await scanResults.waitFor();

  const copilotRow = scanResults
    .getByText("copilot")
    .locator(
      "xpath=ancestor::div[contains(@class,'rounded-lg')][1]",
    );
  await copilotRow.waitFor();
  await copilotRow.getByText("Claude Sonnet 4.5").waitFor();
  await copilotRow.getByRole("button", { name: "Add" }).click();
  await copilotRow.getByText("registered").waitFor();

  const agentsPayload = await fetchJson(
    page,
    "/api/settings/agents",
  );
  assert.equal(agentsPayload.ok, true);
  const agentEntry = Object.entries(
    agentsPayload.data ?? {},
  ).find(([id]) => id.startsWith("copilot"));
  assert.ok(agentEntry, "expected a registered Copilot agent");

  const [agentId, agent] = agentEntry;
  assert.equal(agent.model, "claude-sonnet-4.5");

  let actionsPayload = await fetchJson(
    page,
    "/api/settings/actions",
  );
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (actionsPayload.data?.take === agentId) break;
    await page.waitForTimeout(250);
    actionsPayload = await fetchJson(
      page,
      "/api/settings/actions",
    );
  }
  assert.equal(actionsPayload.ok, true);
  assert.deepEqual(actionsPayload.data, {
    take: agentId,
    scene: agentId,
    breakdown: agentId,
    scopeRefinement: agentId,
  });

  const settingsRaw = await readFile(settingsFile, "utf8");
  assert.match(settingsRaw, new RegExp(`\\[agents\\.${agentId}\\]`));
  assert.match(settingsRaw, /model = "claude-sonnet-4\.5"/);
} finally {
  await browser?.close();
}
