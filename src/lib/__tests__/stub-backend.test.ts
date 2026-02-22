/**
 * Contract tests for StubBackend.
 *
 * Uses the shared contract test harness to verify the stub satisfies
 * the BackendPort behavioural contract for its capability set.
 */

import { runBackendContractTests } from "./backend-contract.test";
import { StubBackend, STUB_CAPABILITIES } from "@/lib/backends/stub-backend";

runBackendContractTests("StubBackend", () => {
  const port = new StubBackend();
  return {
    port,
    capabilities: STUB_CAPABILITIES,
    cleanup: async () => {},
  };
});
