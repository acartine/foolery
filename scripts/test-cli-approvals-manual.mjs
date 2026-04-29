#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  approvalMarker,
  approvalPrompt,
  BlockedError,
  createHarnessBeat,
  detectKnownBlocker,
  forceProviderInSettings,
  hasOpenCodePermissionExtraction,
  log,
  mutateFoolerySettings,
  parseArgs,
  prepareProviderRun,
  providerList,
  providers,
  verifyContinuation,
} from "./test-cli-approvals-manual-core.mjs";
import {
  spawnDevServer,
  startTerminalSession,
  terminateSession,
  verifyAndApproveInBrowser,
  waitForServer,
  waitForSessionEvent,
} from "./test-cli-approvals-manual-runtime.mjs";

function runDryHelperChecks() {
  const settings = {
    dispatchMode: "advanced",
    agents: {
      "claude-validation": {
        command: "claude",
        approvalMode: "bypass",
      },
    },
    pools: {
      planning: [{ agentId: "other", weight: 1 }],
    },
  };
  forceProviderInSettings(
    settings,
    "claude",
    "claude-validation",
    "planning",
  );
  assert.equal(settings.agents["claude-validation"].approvalMode, "prompt");
  assert.deepEqual(settings.pools.planning, [
    { agentId: "claude-validation", weight: 1 },
  ]);

  const visibilitySource =
    'import { extractOpenCodeApproval } from "@/lib/opencode-approval-request";';
  const extractorSource =
    'export function extractOpenCodeApproval() { return "permission.asked"; }';
  assert.equal(
    hasOpenCodePermissionExtraction(visibilitySource, extractorSource),
    true,
  );
  assert.equal(hasOpenCodePermissionExtraction("", ""), false);
  console.log("[approvals] Dry helper checks passed.");
}

async function runProvider(provider, options) {
  let run = null;
  let server = null;
  let sessionId = "";
  try {
    await detectKnownBlocker(provider, options);
    run = await prepareProviderRun(provider);
    await mutateFoolerySettings(provider, options);
    server = spawnDevServer(provider, options, run);
    await waitForServer(server, options.timeoutMs);

    const repo = path.resolve(options.repo);
    const beatId = options.beatId ||
      await createHarnessBeat(provider, repo, run.token);
    log(provider, `Using beat ${beatId} in ${repo}.`);
    sessionId = await startTerminalSession(
      server.baseUrl,
      beatId,
      repo,
      approvalPrompt(provider, run.token),
    );
    log(provider, `Started terminal session ${sessionId}.`);

    await waitForSessionEvent(
      server.baseUrl,
      sessionId,
      options.timeoutMs,
      (event) => String(event.data ?? "").includes(approvalMarker),
    );
    log(provider, "Approval request surfaced in terminal SSE.");

    if (options.skipBrowser) {
      throw new BlockedError("Browser/UI approval step was skipped.");
    }
    await verifyAndApproveInBrowser(server.baseUrl, repo, sessionId, provider);
    log(provider, "Approved first request through Foolery UI.");

    await waitForSessionEvent(
      server.baseUrl,
      sessionId,
      options.timeoutMs,
      (event) => String(event.data ?? "").includes(providers[provider].marker) &&
        String(event.data ?? "").includes(run.token),
    );
    await verifyContinuation(repo, provider, run.token);
    log(provider, "Agent continued after approval.");
    return { provider, status: "PASS", message: "approval round trip passed" };
  } catch (error) {
    if (error instanceof BlockedError) {
      return { provider, status: "BLOCKED", message: error.message };
    }
    return { provider, status: "FAIL", message: error.message };
  } finally {
    if (sessionId && server) {
      await terminateSession(server.baseUrl, sessionId).catch(() => {});
    }
    if (server) await server.stop();
    if (run && !options.keepTestDir) {
      await fs.rm(run.runDir, { recursive: true, force: true });
    }
  }
}

function printSummary(results) {
  console.log("\nApproval harness summary");
  console.log("========================");
  for (const result of results) {
    console.log(`${result.provider}: ${result.status} - ${result.message}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.dryHelperChecks) {
    runDryHelperChecks();
    return;
  }
  const results = [];
  for (const provider of providerList(options.provider)) {
    log(provider, `Starting ${providers[provider].label} approval validation.`);
    results.push(await runProvider(provider, options));
  }
  printSummary(results);
  if (results.some((result) => result.status === "FAIL")) {
    process.exitCode = 1;
  } else if (results.some((result) => result.status === "BLOCKED")) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(`[approvals] ERROR: ${error.message}`);
  process.exitCode = 1;
});
