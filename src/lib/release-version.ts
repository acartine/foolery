import { readFile } from "node:fs/promises";
import { join } from "node:path";

const RELEASE_OWNER = process.env.FOOLERY_RELEASE_OWNER ?? "acartine";
const RELEASE_REPO = process.env.FOOLERY_RELEASE_REPO ?? "foolery";
const CACHE_TTL_MS = 10 * 60_000;

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

async function fetchLatestReleaseTag(): Promise<string | null> {
  if (latestCache && Date.now() - latestCache.checkedAt < CACHE_TTL_MS) {
    return latestCache.tag;
  }

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
      latestCache = { tag: null, checkedAt: Date.now() };
      return null;
    }

    const body = (await res.json()) as { tag_name?: unknown };
    const tag = typeof body.tag_name === "string" ? body.tag_name : null;
    latestCache = { tag, checkedAt: Date.now() };
    return tag;
  } catch {
    latestCache = { tag: null, checkedAt: Date.now() };
    return null;
  }
}

export async function getReleaseVersionStatus(): Promise<ReleaseVersionStatus> {
  const [installedVersion, latestVersion] = await Promise.all([
    readInstalledVersion(),
    fetchLatestReleaseTag(),
  ]);

  return {
    installedVersion,
    latestVersion,
    updateAvailable:
      Boolean(installedVersion) &&
      Boolean(latestVersion) &&
      isNewerVersion(installedVersion!, latestVersion!),
  };
}

export function _resetReleaseVersionCache(): void {
  latestCache = null;
}
