/**
 * OS keychain integration for secret storage.
 * Uses macOS `security` CLI or Linux `secret-tool` via child_process.
 * Commands are executed without a shell to avoid interpolation risks.
 * Falls back gracefully when keychain is unavailable.
 */

import { execFile, spawn } from "node:child_process";
import { platform } from "node:os";

const SERVICE_NAME = "foolery";
const ACCOUNT_NAME = "openrouter-api-key";
const LINUX_LABEL = "Foolery OpenRouter API Key";

/**
 * Store a secret in the OS keychain.
 * Returns true if successful, false if keychain is unavailable.
 */
export async function keychainSet(key: string): Promise<boolean> {
  if (!key) return keychainDelete();
  try {
    const os = platform();
    if (os === "darwin") {
      return await darwinSet(key);
    }
    if (os === "linux") {
      return await linuxSet(key);
    }
    return false; // Unsupported OS
  } catch {
    return false;
  }
}

/**
 * Retrieve a secret from the OS keychain.
 * Returns the secret string or null if not found/unavailable.
 */
export async function keychainGet(): Promise<string | null> {
  try {
    const os = platform();
    if (os === "darwin") {
      const stdout = await runCommand("security", [
        "find-generic-password",
        "-a",
        ACCOUNT_NAME,
        "-s",
        SERVICE_NAME,
        "-w",
      ]);
      return stdout.trim();
    }
    if (os === "linux") {
      const stdout = await runCommand("secret-tool", [
        "lookup",
        "application",
        SERVICE_NAME,
        "key",
        ACCOUNT_NAME,
      ]);
      return stdout.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Delete a secret from the OS keychain.
 * Returns true if successful or entry didn't exist.
 */
export async function keychainDelete(): Promise<boolean> {
  try {
    const os = platform();
    if (os === "darwin") {
      await runCommand("security", [
        "delete-generic-password",
        "-a",
        ACCOUNT_NAME,
        "-s",
        SERVICE_NAME,
      ]);
      return true;
    }
    if (os === "linux") {
      await runCommand("secret-tool", [
        "clear",
        "application",
        SERVICE_NAME,
        "key",
        ACCOUNT_NAME,
      ]);
      return true;
    }
    return false;
  } catch {
    return true; // Entry didn't exist — treat as success
  }
}

async function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      command,
      args,
      { encoding: "utf8" },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function runCommandWithInput(
  command: string,
  args: string[],
  input: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          stderr.trim() || `${command} exited with code ${code ?? "unknown"}`,
        ),
      );
    });

    child.stdin.on("error", (error) => {
      reject(error);
    });
    child.stdin.end(input);
  });
}

async function darwinSet(key: string): Promise<boolean> {
  // Delete existing entry first (ignore errors if absent)
  try {
    await runCommand("security", [
      "delete-generic-password",
      "-a",
      ACCOUNT_NAME,
      "-s",
      SERVICE_NAME,
    ]);
  } catch {
    // Entry didn't exist, that's fine
  }
  await runCommand("security", [
    "add-generic-password",
    "-a",
    ACCOUNT_NAME,
    "-s",
    SERVICE_NAME,
    "-w",
    key,
  ]);
  return true;
}

async function linuxSet(key: string): Promise<boolean> {
  await runCommandWithInput(
    "secret-tool",
    [
      "store",
      `--label=${LINUX_LABEL}`,
      "application",
      SERVICE_NAME,
      "key",
      ACCOUNT_NAME,
    ],
    key,
  );
  return true;
}
