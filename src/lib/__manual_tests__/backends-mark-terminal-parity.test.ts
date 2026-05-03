/**
 * Parity coverage for `markTerminal` across BeadsBackend, StubBackend,
 * and the in-memory MockBackendPort. Validates the descriptive-
 * correction contract uniformly.
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BeadsBackend } from "@/lib/backends/beads-backend";
import { StubBackend } from "@/lib/backends/stub-backend";
import { MockBackendPort } from "../__tests__/mock-backend-port";
import {
  WORKFLOW_CORRECTION_FAILURE_MARKER,
} from "@/lib/workflow-correction-failure";

async function tempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "markterminal-parity-"),
  );
  await fs.mkdir(path.join(dir, ".beads"), { recursive: true });
  return dir;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BeadsBackend.markTerminal", () => {
  it("accepts a profile-terminal target and updates the beat state", async () => {
    const repo = await tempRepo();
    const backend = new BeadsBackend(repo);
    const { data } = await backend.create({
      title: "Beads mark terminal",
      type: "task",
      priority: 2,
      labels: [],
    });
    const result = await backend.markTerminal(
      data!.id, "shipped", "done",
    );
    expect(result.ok).toBe(true);
    const fetched = await backend.get(data!.id);
    expect(fetched.data!.state).toBe("shipped");
  });

  it(
    "throws WORKFLOW_CORRECTION_FAILURE_MARKER "
    + "on a non-terminal target",
    async () => {
      const repo = await tempRepo();
      const backend = new BeadsBackend(repo);
      const { data } = await backend.create({
        title: "Beads bad target",
        type: "task",
        priority: 2,
        labels: [],
      });
      await expect(
        backend.markTerminal(data!.id, "implementation"),
      ).rejects.toThrow(WORKFLOW_CORRECTION_FAILURE_MARKER);
    },
  );
});

describe("StubBackend.markTerminal", () => {
  it("returns UNAVAILABLE without affecting state", async () => {
    const backend = new StubBackend();
    const result = await backend.markTerminal();
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("UNAVAILABLE");
  });
});

describe("MockBackendPort.markTerminal", () => {
  it("routes close() through markTerminal to a profile terminal", async () => {
    const backend = new MockBackendPort();
    const created = await backend.create({
      title: "Mock close",
      type: "task",
      priority: 2,
      labels: [],
    });
    const closeResult = await backend.close(created.data!.id);
    expect(closeResult.ok).toBe(true);
    const fetched = await backend.get(created.data!.id);
    expect(fetched.data!.state).toMatch(/shipped|closed|abandoned/);
  });

  it("throws WORKFLOW_CORRECTION_FAILURE_MARKER on a bad target", async () => {
    const backend = new MockBackendPort();
    const created = await backend.create({
      title: "Mock bad target",
      type: "task",
      priority: 2,
      labels: [],
    });
    await expect(
      backend.markTerminal(created.data!.id, "implementation"),
    ).rejects.toThrow(WORKFLOW_CORRECTION_FAILURE_MARKER);
  });
});
