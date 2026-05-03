/**
 * Unit tests for the `settings-config-validate` doctor check.
 *
 * Each test writes a settings.toml fixture to a tempdir and runs the
 * check directly against that path, so the real `~/.config` is never
 * touched. The schema-violation path asserts that the Zod field path
 * is surfaced verbatim in the diagnostic message — no "config problem"
 * coalescing.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SETTINGS_VALIDATE_CHECK,
  checkSettingsValidate,
} from "@/lib/doctor-checks-settings-validate";

// Minimal valid fixture: every top-level key in foolerySettingsSchema
// has a `.default(...)`, so an empty TOML parses to defaults and
// validates cleanly. We write a few keys explicitly so the replace()
// call in the schema-violation test has something to target.
const VALID_SETTINGS_TOML = `
dispatchMode = "basic"
maxConcurrentSessions = 5
maxClaimsPerQueueType = 10
terminalLightTheme = false
`;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "foolery-doctor-validate-"),
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(name: string, contents: string): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, contents);
  return p;
}

describe("checkSettingsValidate", () => {
  it("reports info on a valid settings.toml", async () => {
    const fixture = writeFixture("settings.toml", VALID_SETTINGS_TOML);

    const diags = await checkSettingsValidate(fixture);

    expect(diags).toHaveLength(1);
    expect(diags[0].check).toBe(SETTINGS_VALIDATE_CHECK);
    expect(diags[0].severity).toBe("info");
    expect(diags[0].fixable).toBe(false);
    expect(diags[0].message).toContain(fixture);
  });

  it("reports an error per Zod issue, with the field path in .message",
    async () => {
      // maxConcurrentSessions has schema .max(20); 999 is rejected.
      const broken = VALID_SETTINGS_TOML.replace(
        "maxConcurrentSessions = 5",
        "maxConcurrentSessions = 999",
      );
      const fixture = writeFixture("settings.toml", broken);

      const diags = await checkSettingsValidate(fixture);

      expect(diags.length).toBeGreaterThanOrEqual(1);
      for (const d of diags) {
        expect(d.check).toBe(SETTINGS_VALIDATE_CHECK);
        expect(d.severity).toBe("error");
        expect(d.fixable).toBe(false);
      }
      const joined = diags.map((d) => d.message).join("\n");
      expect(joined).toContain("maxConcurrentSessions");
      expect(joined).not.toContain("config problem");
      const hit = diags.find(
        (d) => d.context?.zodPath === "maxConcurrentSessions",
      );
      expect(hit).toBeDefined();
      expect(hit?.context?.filePath).toBe(fixture);
      // The Zod "too_big" issue carries the received value as the
      // constraint bound, surfaced via the issue message.
      expect(hit?.message).toContain("20");
    },
  );

  it("reports an error on a TOML parse failure", async () => {
    const fixture = writeFixture("settings.toml", "not = [valid\n");

    const diags = await checkSettingsValidate(fixture);

    expect(diags).toHaveLength(1);
    expect(diags[0].check).toBe(SETTINGS_VALIDATE_CHECK);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message).toContain("TOML parse error");
    expect(diags[0].message).toContain(fixture);
  });

  it("reports a warning when the settings file cannot be read", async () => {
    const missing = path.join(tmpDir, "does-not-exist.toml");

    const diags = await checkSettingsValidate(missing);

    expect(diags).toHaveLength(1);
    expect(diags[0].check).toBe(SETTINGS_VALIDATE_CHECK);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].fixable).toBe(false);
    expect(diags[0].message).toContain(missing);
  });
});
