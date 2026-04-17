/**
 * Knots guardrails: raw state metadata and
 * capability-aware API guard behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KNOTS_METADATA_KEYS } from "@/lib/knots-constants";
import {
  KNOTS_CAPABILITIES,
} from "@/lib/backends/knots-backend";
import { backendErrorStatus } from "@/lib/backend-http";

import {
  store,
  resetStore,
  nowIso,
  mockSetKnotProfile,
} from "./knots-guardrails-mocks";

vi.mock("@/lib/knots", async () =>
  (await import("./knots-guardrails-mocks")).buildMockModule(),
);

import { KnotsBackend } from "@/lib/backends/knots-backend";

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

// ── g3y1.5.1: Raw state preserved in metadata ──────────────

describe("Knots-state: raw state preservation", () => {
  it("preserves raw Knots state in Beat.metadata.knotsState", async () => {
    const now = nowIso();
    store.knots.set("K-raw", {
      id: "K-raw",
      title: "Raw state test",
      state: "ready_for_implementation",
      profile_id: "autopilot",
      workflow_id: "autopilot",
      updated_at: now,
      body: null,
      description: null,
      priority: 1,
      type: "work",
      tags: [],
      notes: [],
      handoff_capsules: [],
      workflow_etag: "etag-1",
      created_at: now,
    });

    const backend = new KnotsBackend("/repo");
    const result = await backend.get("K-raw");
    expect(result.ok).toBe(true);
    const beat = result.data!;

    expect(beat.metadata).toBeDefined();
    expect(
      beat.metadata![KNOTS_METADATA_KEYS.state],
    ).toBe("ready_for_implementation");
    expect(
      beat.metadata![KNOTS_METADATA_KEYS.profileId],
    ).toBe("autopilot");
  });

  it("preserves raw state even when workflow normalizes it", async () => {
    const now = nowIso();
    store.knots.set("K-norm", {
      id: "K-norm",
      title: "Normalized state test",
      state: "implementation",
      profile_id: "autopilot",
      workflow_id: "autopilot",
      updated_at: now,
      body: null,
      description: null,
      priority: 0,
      type: "task",
      tags: ["urgent"],
      notes: [{
        content: "started work",
        username: "agent",
        datetime: now,
      }],
      handoff_capsules: [{
        content: "handoff data",
        username: "agent",
        datetime: now,
      }],
      workflow_etag: "etag-2",
      created_at: now,
    });

    const backend = new KnotsBackend("/repo");
    const result = await backend.get("K-norm");
    expect(result.ok).toBe(true);
    const beat = result.data!;

    expect(beat.state).toBe("implementation");
    expect(
      beat.metadata![KNOTS_METADATA_KEYS.state],
    ).toBe("implementation");
    expect(
      beat.metadata![KNOTS_METADATA_KEYS.handoffCapsules],
    ).toBeInstanceOf(Array);
    expect(
      beat.metadata![KNOTS_METADATA_KEYS.notes],
    ).toBeInstanceOf(Array);
  });
});

describe("Knots-state: etag preservation", () => {
  it("preserves profile etag and workflow etag in metadata", async () => {
    const now = nowIso();
    store.knots.set("K-etag", {
      id: "K-etag",
      title: "Etag test",
      state: "ready_for_planning",
      profile_id: "autopilot",
      workflow_id: "autopilot",
      updated_at: now,
      body: null,
      description: null,
      priority: 2,
      type: "work",
      tags: [],
      notes: [],
      handoff_capsules: [],
      workflow_etag: "wf-etag-xyz",
      created_at: now,
      profile_etag: "prof-etag-abc",
    });

    const backend = new KnotsBackend("/repo");
    const result = await backend.get("K-etag");
    expect(result.ok).toBe(true);

    const md = result.data!.metadata!;
    expect(
      md[KNOTS_METADATA_KEYS.workflowEtag],
    ).toBe("wf-etag-xyz");
    expect(
      md[KNOTS_METADATA_KEYS.profileEtag],
    ).toBe("prof-etag-abc");
  });
});

// ── g3y1.5.2: Capability-aware API guard behavior ───────────

describe("Capability-aware API guard behavior", () => {
  it("KNOTS_CAPABILITIES has canDelete=false", () => {
    expect(KNOTS_CAPABILITIES.canDelete).toBe(false);
  });

  it("KNOTS_CAPABILITIES has canSync=true", () => {
    expect(KNOTS_CAPABILITIES.canSync).toBe(true);
  });

  it("KnotsBackend.delete() returns UNSUPPORTED error", async () => {
    const backend = new KnotsBackend("/repo");
    const result = await backend.delete();
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("UNSUPPORTED");
    expect(result.error!.retryable).toBe(false);
  });

  it("UNSUPPORTED error maps to HTTP 405", () => {
    const status = backendErrorStatus({
      code: "UNSUPPORTED",
      message: "Operation not supported",
      retryable: false,
    });
    expect(status).toBe(405);
  });

  it("KnotsBackend.update() supports profileId changes", async () => {
    const backend = new KnotsBackend("/repo");
    const created = await backend.create({
      title: "Profile change test",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);

    const result = await backend.update(
      created.data!.id, { profileId: "semiauto" },
    );
    expect(result.ok).toBe(true);
    expect(mockSetKnotProfile).toHaveBeenCalledWith(
      created.data!.id,
      "semiauto",
      "/repo",
      expect.objectContaining({
        state: "ready_for_planning",
      }),
    );
  });

  it("KnotsBackend.update() rejects unknown profileId changes", async () => {
    const backend = new KnotsBackend("/repo");
    const created = await backend.create({
      title: "Profile change test",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);

    const result = await backend.update(
      created.data!.id, { profileId: "new-profile" },
    );
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
  });

  it("backend error codes map to non-500 HTTP statuses", () => {
    const nonGenericCodes = [
      { code: "NOT_FOUND", expected: 404 },
      { code: "ALREADY_EXISTS", expected: 409 },
      { code: "INVALID_INPUT", expected: 400 },
      { code: "LOCKED", expected: 423 },
      { code: "TIMEOUT", expected: 504 },
      { code: "UNAVAILABLE", expected: 503 },
      { code: "UNSUPPORTED", expected: 405 },
      { code: "PERMISSION_DENIED", expected: 403 },
      { code: "CONFLICT", expected: 409 },
      { code: "RATE_LIMITED", expected: 429 },
    ];

    for (const { code, expected } of nonGenericCodes) {
      const status = backendErrorStatus({
        code, message: "test", retryable: false,
      });
      expect(status).toBe(expected);
    }
  });
});
