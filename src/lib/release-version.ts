import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const RELEASE_OWNER = process.env.FOOLERY_RELEASE_OWNER ?? "acartine";
const RELEASE_REPO = process.env.FOOLERY_RELEASE_REPO ?? "foolery";
const MEMORY_CACHE_TTL_MS = 10 * 60_000;
const PERSISTENT_CACHE_TTL_MS = 24 * 60 * 60_000; // 24 hours

const CONFIG_DIR = join(homedir(), ".config", "foolery");
const VERSION_CHECK_FILE = join(CONFIG_DIR, "version-check.json");

type LatestCacheEntry = {
  tag: string | null;
  checkedAt: number;
};

let latestCache: LatestCacheEntry | null = null;

export type ReleaseVersionStatus = {
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
};

function parseSemverTriplet(raw: string): [number, number, number] | null {
  const normalized = raw.replace(/^v/, "").split("-")[0]?.split("+")[0];
  if (!normalized) return null;
  const [major, minor = "0", patch = "0"] = normalized.split(".");
  if (!/^\d+$/.test(major) || !/^\d+$/.test(minor) || !/^\d+$/.test(patch)) {
    return null;
  }
  return [Number(major), Number(minor), Number(patch)];
}

function isNewerVersion(installed: string, latest: string): boolean {
  const installedTriplet = parseSemverTriplet(installed);
  const latestTriplet = parseSemverTriplet(latest);
  if (!installedTriplet || !latestTriplet) return false;

  if (latestTriplet[0] !== installedTriplet[0]) {
    return latestTriplet[0] > installedTriplet[0];
  }
  if (latestTriplet[1] !== installedTriplet[1]) {
    return latestTriplet[1] > installedTriplet[1];
  }
  return latestTriplet[2] > installedTriplet[2];
}

async function readInstalledVersion(): Promise<string | null> {
  const releaseVersionPath = join(process.cwd(), "RELEASE_VERSION");
  try {
    const fromReleaseFile = (await readFile(releaseVersionPath, "utf-8")).trim();
    if (fromReleaseFile) return fromReleaseFile;
  } catch {
    // Fallback to package.json below.
  }

  const packageJsonPath = join(process.cwd(), "package.json");
  try {
    const raw = await readFile(packageJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.trim().length > 0) {
      return parsed.version.trim();
    }
  } catch {
    // Missing file or invalid JSON should not break the UI.
  }

  return null;
}

/** Read the persistent version-check cache from disk. */
async function readPersistentCache(): Promise<LatestCacheEntry | null> {
  try {
    const raw = await readFile(VERSION_CHECK_FILE, "utf-8");
    const parsed = JSON.parse(raw) as { tag?: unknown; checkedAt?: unknown };
    if (typeof parsed.checkedAt === "number") {
      return {
        tag: typeof parsed.tag === "string" ? parsed.tag : null,
        checkedAt: parsed.checkedAt,
      };
    }
  } catch {
    // File doesn't exist or is invalid — treat as never checked.
  }
  return null;
}

/** Write the version-check result to persistent cache. */
async function writePersistentCache(entry: LatestCacheEntry): Promise<void> {
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(VERSION_CHECK_FILE, JSON.stringify(entry), "utf-8");
  } catch {
    // Non-critical — skip silently.
  }
}

async function fetchLatestReleaseTag(force?: boolean): Promise<string | null> {
  // 1. In-memory cache (short TTL for repeated calls within one server lifecycle)
  if (!force && latestCache && Date.now() - latestCache.checkedAt < MEMORY_CACHE_TTL_MS) {
    return latestCache.tag;
  }

  // 2. Persistent disk cache (24h TTL)
  if (!force) {
    const persistent = await readPersistentCache();
    if (persistent && Date.now() - persistent.checkedAt < PERSISTENT_CACHE_TTL_MS) {
      latestCache = persistent;
      return persistent.tag;
    }
  }

  // 3. Fetch from GitHub
  try {
    const res = await fetch(
      `https://api.github.com/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "foolery-app",
        },
        cache: "no-store",
      },
    );
    if (!res.ok) {
      const entry: LatestCacheEntry = { tag: null, checkedAt: Date.now() };
      latestCache = entry;
      await writePersistentCache(entry);
      return null;
    }

    const body = (await res.json()) as { tag_name?: unknown };
    const tag = typeof body.tag_name === "string" ? body.tag_name : null;
    const entry: LatestCacheEntry = { tag, checkedAt: Date.now() };
    latestCache = entry;
    await writePersistentCache(entry);
    return tag;
  } catch {
    const entry: LatestCacheEntry = { tag: null, checkedAt: Date.now() };
    latestCache = entry;
    await writePersistentCache(entry);
    return null;
  }
}

export async function getReleaseVersionStatus(force?: boolean): Promise<ReleaseVersionStatus> {
  const [installedVersion, latestVersion] = await Promise.all([
    readInstalledVersion(),
    fetchLatestReleaseTag(force),
  ]);
  const updateAvailable =
    installedVersion !== null &&
    latestVersion !== null &&
    isNewerVersion(installedVersion, latestVersion);

  return {
    installedVersion,
    latestVersion,
    updateAvailable,
  };
}

export function _resetReleaseVersionCache(): void {
  latestCache = null;
}
