/**
 * Contract tests for BeadsBackend.
 *
 * Uses the shared contract test harness to verify the JSONL-backed
 * backend satisfies the BackendPort behavioural contract.
 */

import { runBackendContractTests } from "./backend-contract.test";
import { BeadsBackend, BEADS_CAPABILITIES } from "@/lib/backends/beads-backend";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

runBackendContractTests("BeadsBackend", () => {
  // Create a fresh temp directory with an empty .beads/issues.jsonl
  const tempDir = mkdtempSync(join(tmpdir(), "beads-test-"));
  const beadsDir = join(tempDir, ".beads");
  mkdirSync(beadsDir, { recursive: true });
  writeFileSync(join(beadsDir, "issues.jsonl"), "", "utf-8");

  const port = new BeadsBackend(tempDir);

  return {
    port,
    capabilities: BEADS_CAPABILITIES,
    cleanup: async () => {
      port._reset();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
});
