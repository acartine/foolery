import { describe, it, expect } from "vitest";
import {
  FULL_CAPABILITIES,
  READ_ONLY_CAPABILITIES,
  assertCapability,
  hasCapability,
  type BackendCapabilities,
} from "@/lib/backend-capabilities";

// ── assertCapability ──────────────────────────────────────────

describe("assertCapability", () => {
  it("throws when a boolean capability is false", () => {
    expect(() =>
      assertCapability(READ_ONLY_CAPABILITIES, "canCreate", "create bead"),
    ).toThrowError(
      "Backend does not support create bead (missing capability: canCreate)",
    );
  });

  it("throws when maxConcurrency is 0 (unlimited treated as disabled)", () => {
    expect(() =>
      assertCapability(
        FULL_CAPABILITIES,
        "maxConcurrency",
        "concurrent operations",
      ),
    ).toThrowError(
      "Backend does not support concurrent operations (missing capability: maxConcurrency)",
    );
  });

  it("does not throw when a boolean capability is true", () => {
    expect(() =>
      assertCapability(FULL_CAPABILITIES, "canCreate", "create bead"),
    ).not.toThrow();
  });

  it("does not throw when maxConcurrency is > 0", () => {
    const caps: BackendCapabilities = {
      ...FULL_CAPABILITIES,
      maxConcurrency: 4,
    };
    expect(() =>
      assertCapability(caps, "maxConcurrency", "concurrent operations"),
    ).not.toThrow();
  });

  it("includes operation name and flag in error message", () => {
    expect(() =>
      assertCapability(READ_ONLY_CAPABILITIES, "canDelete", "delete bead"),
    ).toThrowError(/delete bead.*canDelete/);
  });
});

// ── hasCapability ─────────────────────────────────────────────

describe("hasCapability", () => {
  it("returns true for enabled boolean flags", () => {
    expect(hasCapability(FULL_CAPABILITIES, "canCreate")).toBe(true);
    expect(hasCapability(FULL_CAPABILITIES, "canSearch")).toBe(true);
  });

  it("returns false for disabled boolean flags", () => {
    expect(hasCapability(READ_ONLY_CAPABILITIES, "canCreate")).toBe(false);
    expect(hasCapability(READ_ONLY_CAPABILITIES, "canSync")).toBe(false);
  });

  it("returns false when maxConcurrency is 0", () => {
    expect(hasCapability(FULL_CAPABILITIES, "maxConcurrency")).toBe(false);
  });

  it("returns true when maxConcurrency is > 0", () => {
    const caps: BackendCapabilities = {
      ...FULL_CAPABILITIES,
      maxConcurrency: 8,
    };
    expect(hasCapability(caps, "maxConcurrency")).toBe(true);
  });
});

// ── FULL_CAPABILITIES ─────────────────────────────────────────

describe("FULL_CAPABILITIES", () => {
  const booleanFlags: (keyof BackendCapabilities)[] = [
    "canCreate",
    "canUpdate",
    "canDelete",
    "canClose",
    "canSearch",
    "canQuery",
    "canListReady",
    "canManageDependencies",
    "canManageLabels",
    "canSync",
  ];

  it.each(booleanFlags)("has %s enabled", (flag) => {
    expect(FULL_CAPABILITIES[flag]).toBe(true);
  });

  it("has maxConcurrency set to 0 (unlimited)", () => {
    expect(FULL_CAPABILITIES.maxConcurrency).toBe(0);
  });
});

// ── READ_ONLY_CAPABILITIES ───────────────────────────────────

describe("READ_ONLY_CAPABILITIES", () => {
  const writeFlags: (keyof BackendCapabilities)[] = [
    "canCreate",
    "canUpdate",
    "canDelete",
    "canClose",
    "canManageDependencies",
    "canManageLabels",
    "canSync",
  ];

  const readFlags: (keyof BackendCapabilities)[] = [
    "canSearch",
    "canQuery",
    "canListReady",
  ];

  it.each(writeFlags)("has write flag %s disabled", (flag) => {
    expect(READ_ONLY_CAPABILITIES[flag]).toBe(false);
  });

  it.each(readFlags)("has read flag %s enabled", (flag) => {
    expect(READ_ONLY_CAPABILITIES[flag]).toBe(true);
  });

  it("has maxConcurrency set to 0 (unlimited)", () => {
    expect(READ_ONLY_CAPABILITIES.maxConcurrency).toBe(0);
  });
});

// ── Immutability ──────────────────────────────────────────────

describe("preset immutability", () => {
  it("FULL_CAPABILITIES is frozen", () => {
    expect(Object.isFrozen(FULL_CAPABILITIES)).toBe(true);
  });

  it("READ_ONLY_CAPABILITIES is frozen", () => {
    expect(Object.isFrozen(READ_ONLY_CAPABILITIES)).toBe(true);
  });

  it("mutations to FULL_CAPABILITIES throw in strict mode", () => {
    expect(() => {
      (FULL_CAPABILITIES as BackendCapabilities).canCreate = false;
    }).toThrow();
  });

  it("mutations to READ_ONLY_CAPABILITIES throw in strict mode", () => {
    expect(() => {
      (READ_ONLY_CAPABILITIES as BackendCapabilities).canCreate = true;
    }).toThrow();
  });
});
