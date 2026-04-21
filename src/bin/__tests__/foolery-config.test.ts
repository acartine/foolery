import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI_PATH = path.resolve(__dirname, "..", "foolery-config.ts");

type RunResult = { status: number; stdout: string; stderr: string };

function runCli(args: ReadonlyArray<string>): RunResult {
  const result = spawnSync("bun", ["run", CLI_PATH, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

let tmpDir = "";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "foolery-config-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(name: string, content: string): string {
  const fixturePath = path.join(tmpDir, name);
  fs.writeFileSync(fixturePath, content, "utf8");
  return fixturePath;
}

describe("foolery-config CLI: dispatch", () => {
  it("prints help on `help` and exits 0", () => {
    const { status, stdout } = runCli(["help"]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/Usage: foolery config/);
    expect(stdout).toMatch(/schema/);
    expect(stdout).toMatch(/validate/);
  });

  it("prints help with no args and exits 0", () => {
    const { status, stdout } = runCli([]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/Usage: foolery config/);
  });

  it("returns exit 2 for an unknown subcommand", () => {
    const { status, stderr } = runCli(["nope"]);
    expect(status).toBe(2);
    expect(stderr).toMatch(/unknown subcommand "nope"/);
  });
});

describe("foolery-config CLI: schema", () => {
  it("emits valid JSON with all expected top-level keys", () => {
    const { status, stdout } = runCli(["schema"]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as {
      $schema?: string;
      properties?: Record<string, unknown>;
    };
    expect(parsed.$schema).toMatch(/json-schema\.org.*2020-12/);
    const props = parsed.properties ?? {};
    expect(Object.keys(props).sort()).toEqual([
      "actions",
      "agents",
      "backend",
      "defaults",
      "dispatchMode",
      "maxClaimsPerQueueType",
      "maxConcurrentSessions",
      "pools",
      "scopeRefinement",
      "terminalLightTheme",
    ]);
  });
});

describe("foolery-config CLI: validate (success)", () => {
  it("accepts a minimal valid config and prints OK", () => {
    const fixturePath = writeFixture(
      "good.toml",
      "dispatchMode = \"basic\"\n"
      + "maxConcurrentSessions = 5\n"
      + "maxClaimsPerQueueType = 10\n"
      + "terminalLightTheme = false\n",
    );
    const { status, stdout } = runCli(["validate", fixturePath]);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe(`OK ${fixturePath}`);
  });

  it("accepts a rich advanced-mode config with agents and pools", () => {
    const fixturePath = writeFixture(
      "advanced.toml",
      "dispatchMode = \"advanced\"\n"
      + "maxConcurrentSessions = 8\n"
      + "\n"
      + "[agents.claude-claude-opus-4-7]\n"
      + "command = \"/usr/local/bin/claude\"\n"
      + "vendor = \"claude\"\n"
      + "model = \"claude-opus-4-7\"\n"
      + "\n"
      + "[[pools.implementation]]\n"
      + "agentId = \"claude-claude-opus-4-7\"\n"
      + "weight = 1\n",
    );
    const { status } = runCli(["validate", fixturePath]);
    expect(status).toBe(0);
  });
});

describe("foolery-config CLI: validate (failure)", () => {
  it("rejects out-of-range maxConcurrentSessions and names the field", () => {
    const fixturePath = writeFixture(
      "bad-range.toml",
      "maxConcurrentSessions = 999\nmaxClaimsPerQueueType = 10\n",
    );
    const { status, stderr } = runCli(["validate", fixturePath]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/maxConcurrentSessions/);
    expect(stderr).toMatch(/20/);
  });

  it("rejects a missing required agent field and names the path", () => {
    const fixturePath = writeFixture(
      "missing-command.toml",
      "[agents.claude-broken]\nvendor = \"claude\"\n",
    );
    const { status, stderr } = runCli(["validate", fixturePath]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/agents\.claude-broken\.command/);
  });

  it("returns exit 2 on a TOML parse error and names the file", () => {
    const fixturePath = writeFixture(
      "broken.toml",
      "this is not = valid = toml\n",
    );
    const { status, stderr } = runCli(["validate", fixturePath]);
    expect(status).toBe(2);
    expect(stderr).toMatch(/TOML parse error/);
    expect(stderr).toMatch(/broken\.toml/);
  });

  it("returns exit 2 when the file does not exist", () => {
    const missing = path.join(tmpDir, "does-not-exist.toml");
    const { status, stderr } = runCli(["validate", missing]);
    expect(status).toBe(2);
    expect(stderr).toMatch(/cannot read/);
  });
});
