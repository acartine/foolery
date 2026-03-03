/**
 * OS keychain integration for secret storage.
 * Uses macOS `security` CLI or Linux `secret-tool` via child_process.
 * Falls back gracefully when keychain is unavailable.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";

const execAsync = promisify(exec);

const SERVICE_NAME = "foolery";
const ACCOUNT_NAME = "openrouter-api-key";

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
      const { stdout } = await execAsync(
        `security find-generic-password -a ${q(ACCOUNT_NAME)} -s ${q(SERVICE_NAME)} -w`,
      );
      return stdout.trim();
    }
    if (os === "linux") {
      const { stdout } = await execAsync(
        `secret-tool lookup application ${q(SERVICE_NAME)} key ${q(ACCOUNT_NAME)}`,
      );
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
      await execAsync(
        `security delete-generic-password -a ${q(ACCOUNT_NAME)} -s ${q(SERVICE_NAME)}`,
      );
      return true;
    }
    if (os === "linux") {
      await execAsync(
        `secret-tool clear application ${q(SERVICE_NAME)} key ${q(ACCOUNT_NAME)}`,
      );
      return true;
    }
    return false;
  } catch {
    return true; // Entry didn't exist — treat as success
  }
}

/** Shell-quote a value using JSON.stringify (produces double-quoted string). */
function q(value: string): string {
  return JSON.stringify(value);
}

async function darwinSet(key: string): Promise<boolean> {
  // Delete existing entry first (ignore errors if absent)
  try {
    await execAsync(
      `security delete-generic-password -a ${q(ACCOUNT_NAME)} -s ${q(SERVICE_NAME)}`,
    );
  } catch {
    // Entry didn't exist, that's fine
  }
  await execAsync(
    `security add-generic-password -a ${q(ACCOUNT_NAME)} -s ${q(SERVICE_NAME)} -w ${q(key)}`,
  );
  return true;
}

async function linuxSet(key: string): Promise<boolean> {
  await execAsync(
    `echo -n ${q(key)} | secret-tool store --label="Foolery OpenRouter API Key" application ${q(SERVICE_NAME)} key ${q(ACCOUNT_NAME)}`,
  );
  return true;
}
