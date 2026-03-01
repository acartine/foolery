import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildBeadBreakdownPrompt,
  consumeDirectPrefillPayload,
  setDirectPrefillPayload,
  DIRECT_PREFILL_KEY,
  type DirectPrefillPayload,
} from "@/lib/breakdown-prompt";

// ── buildBeadBreakdownPrompt ─────────────────────────────

describe("buildBeadBreakdownPrompt", () => {
  it("interpolates bead id and title into prompt text", () => {
    const prompt = buildBeadBreakdownPrompt("foolery-abc1", "Fix login bug");
    expect(prompt).toContain("foolery-abc1");
    expect(prompt).toContain("Fix login bug");
  });

  it("mentions hierarchical tasks and execution order", () => {
    const prompt = buildBeadBreakdownPrompt("b-1", "Setup CI");
    expect(prompt).toMatch(/hierarchical tasks/i);
    expect(prompt).toMatch(/execution order/i);
    expect(prompt).toMatch(/parallel execution/i);
  });

  it("returns non-empty string for minimal inputs", () => {
    const prompt = buildBeadBreakdownPrompt("x", "y");
    expect(prompt.length).toBeGreaterThan(10);
  });

  it("handles special characters in title", () => {
    const prompt = buildBeadBreakdownPrompt("b-2", 'Fix "login" & <auth>');
    expect(prompt).toContain('Fix "login" & <auth>');
    expect(prompt).toContain("b-2");
  });
});

// ── Payload round-trip ───────────────────────────────────

describe("DirectPrefillPayload", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips a valid payload through sessionStorage", () => {
    const payload: DirectPrefillPayload = {
      prompt: "Break this bead down",
      autorun: true,
      sourceBeatId: "foolery-abc1",
    };

    setDirectPrefillPayload(payload);
    expect(storage.has(DIRECT_PREFILL_KEY)).toBe(true);

    const result = consumeDirectPrefillPayload();
    expect(result).toEqual(payload);
  });

  it("consumes the payload (one-shot)", () => {
    setDirectPrefillPayload({
      prompt: "test prompt",
      autorun: false,
      sourceBeatId: "b-1",
    });

    const first = consumeDirectPrefillPayload();
    expect(first).not.toBeNull();

    const second = consumeDirectPrefillPayload();
    expect(second).toBeNull();
  });

  it("returns null for missing payload", () => {
    expect(consumeDirectPrefillPayload()).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    storage.set(DIRECT_PREFILL_KEY, "not json");
    expect(consumeDirectPrefillPayload()).toBeNull();
  });

  it("returns null for payload with missing required fields", () => {
    storage.set(
      DIRECT_PREFILL_KEY,
      JSON.stringify({ prompt: "ok", autorun: true })
    );
    expect(consumeDirectPrefillPayload()).toBeNull();
  });

  it("returns null for empty prompt string", () => {
    storage.set(
      DIRECT_PREFILL_KEY,
      JSON.stringify({ prompt: "", autorun: true, sourceBeatId: "x" })
    );
    expect(consumeDirectPrefillPayload()).toBeNull();
  });

  it("returns null for empty sourceBeatId", () => {
    storage.set(
      DIRECT_PREFILL_KEY,
      JSON.stringify({ prompt: "ok", autorun: true, sourceBeatId: "" })
    );
    expect(consumeDirectPrefillPayload()).toBeNull();
  });
});

// ── E2E-style integration (foolery-qqla.4.1) ────────────

describe("bead-detail-to-Direct autorun journey (unit-level)", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("simulates the full Breakdown click → Direct prefill flow", () => {
    // Step 1: Build prompt from bead context (like BeadDetailLightbox does)
    const beadId = "foolery-test1";
    const beadTitle = "Implement user authentication";
    const prompt = buildBeadBreakdownPrompt(beadId, beadTitle);

    expect(prompt).toContain(beadId);
    expect(prompt).toContain(beadTitle);

    // Step 2: Store prefill payload (like BeadDetailLightbox does on click)
    setDirectPrefillPayload({
      prompt,
      autorun: true,
      sourceBeatId: beadId,
    });

    // Step 3: Direct page consumes the payload (like OrchestrationView does on mount)
    const payload = consumeDirectPrefillPayload();
    expect(payload).not.toBeNull();
    expect(payload!.prompt).toBe(prompt);
    expect(payload!.autorun).toBe(true);
    expect(payload!.sourceBeatId).toBe(beadId);

    // Step 4: Payload is consumed — second read returns null (no duplicate autorun)
    expect(consumeDirectPrefillPayload()).toBeNull();
  });

  it("autorun=false should not trigger automatic execution", () => {
    setDirectPrefillPayload({
      prompt: "Some manual prompt",
      autorun: false,
      sourceBeatId: "b-manual",
    });

    const payload = consumeDirectPrefillPayload();
    expect(payload).not.toBeNull();
    expect(payload!.autorun).toBe(false);
  });
});

// ── Regression: non-autorun Direct usage (foolery-qqla.4.2) ──

describe("non-autorun Direct usage regression", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when no prefill payload is stored (normal Direct usage)", () => {
    // When navigating to Direct without going through Breakdown,
    // there is no payload in sessionStorage.
    const payload = consumeDirectPrefillPayload();
    expect(payload).toBeNull();
  });

  it("does not interfere with other sessionStorage keys", () => {
    // Simulate existing orchestration restage draft data
    const otherKey = "foolery:orchestration-restage-draft";
    storage.set(otherKey, JSON.stringify({ repoPath: "/test" }));

    // No prefill payload should be detected
    expect(consumeDirectPrefillPayload()).toBeNull();

    // Other keys should be untouched
    expect(storage.has(otherKey)).toBe(true);
  });

  it("handles corrupt payload gracefully without throwing", () => {
    storage.set(DIRECT_PREFILL_KEY, "{invalid json}}}");
    expect(() => consumeDirectPrefillPayload()).not.toThrow();
    expect(consumeDirectPrefillPayload()).toBeNull();
  });

  it("rejects payload with wrong types", () => {
    storage.set(
      DIRECT_PREFILL_KEY,
      JSON.stringify({ prompt: 123, autorun: "yes", sourceBeatId: null })
    );
    expect(consumeDirectPrefillPayload()).toBeNull();
  });
});
