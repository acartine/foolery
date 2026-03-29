import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.FOOLERY_BASE_URL ?? "http://localhost:3100";
const repoPath = process.env.FOOLERY_REPO_PATH ?? process.cwd();
const targetUrl =
  `${baseUrl}/beats?repo=${encodeURIComponent(repoPath)}&state=queued&diagnostics=1`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(targetUrl, { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__FOOLERY_DIAGNOSTICS__));
await page.waitForTimeout(12_000);

const snapshot = await page.evaluate(() => window.__FOOLERY_DIAGNOSTICS__?.getSnapshot?.() ?? null);
if (!snapshot) {
  throw new Error("Diagnostics handle was not available on the page");
}

const outputDir = join(process.cwd(), "work", "perf-baselines");
await mkdir(outputDir, { recursive: true });

const outputPath = join(outputDir, `${Date.now()}-baseline.json`);
await writeFile(outputPath, JSON.stringify({
  collectedAt: new Date().toISOString(),
  url: targetUrl,
  snapshot,
}, null, 2));

await browser.close();

console.log(outputPath);
