const BEAT_PREFIX_PATTERN = /^[^-]+-/;

/** Render beat IDs without repo prefix (e.g. "foolery-xmvb" -> "xmvb"). */
export function stripBeatPrefix(beatId: string): string {
  return beatId.replace(BEAT_PREFIX_PATTERN, "");
}

/** Extract the repo-name prefix from a beat ID (e.g. "my-project-xmvb" -> "my-project"). */
export function extractBeatPrefix(beatId: string): string | null {
  const pivot = beatId.lastIndexOf("-");
  if (pivot <= 0 || pivot === beatId.length - 1) return null;
  return beatId.slice(0, pivot);
}

interface RepoMatch {
  name: string;
  path: string;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function getPathBasename(path: string): string | null {
  if (!path) return null;
  const parts = path.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

/**
 * Resolve which registered repo owns a beat ID by matching `<project-prefix>-`.
 * Prefixes are matched against both the stored repo name and the repo path basename.
 * Uses the longest matching prefix so hyphenated project names are handled correctly.
 */
export function findRepoForBeatId<T extends RepoMatch>(
  beatId: string,
  repos: readonly T[],
): T | null {
  const normalizedBeatId = normalizeToken(beatId);
  if (!normalizedBeatId.includes("-")) return null;

  let match: T | null = null;
  let longestPrefixLength = -1;
  for (const repo of repos) {
    const prefixes = new Set<string>([repo.name]);
    const basename = getPathBasename(repo.path);
    if (basename) prefixes.add(basename);

    for (const prefix of prefixes) {
      const normalizedPrefix = normalizeToken(prefix);
      if (!normalizedPrefix) continue;
      if (!normalizedBeatId.startsWith(`${normalizedPrefix}-`)) continue;
      if (normalizedPrefix.length > longestPrefixLength) {
        match = repo;
        longestPrefixLength = normalizedPrefix.length;
      }
    }
  }
  return match;
}

/**
 * Resolve the repo path for beat focus.
 * Prefers an explicit repoPath carried by the notification, then falls back
 * to matching the beat ID prefix against registered repos.
 */
export function resolveBeatRepoPath<T extends RepoMatch>(
  beatId: string,
  repos: readonly T[],
  explicitRepoPath?: string | null,
): string | null {
  const normalizedExplicit = explicitRepoPath?.trim();
  if (normalizedExplicit) return normalizedExplicit;
  return findRepoForBeatId(beatId, repos)?.path ?? null;
}

interface BuildBeatFocusHrefOptions {
  detailRepo?: string | null;
  repo?: string | null;
}

/**
 * Build a /beats URL that focuses a specific beat in the list/detail pane.
 * Preserves existing query params and updates beat/detailRepo as needed.
 */
export function buildBeatFocusHref(
  beatId: string,
  currentSearch: string,
  options?: BuildBeatFocusHrefOptions,
): string {
  const params = new URLSearchParams(currentSearch);
  if (options && "repo" in options) {
    if (options.repo) params.set("repo", options.repo);
    else params.delete("repo");
  }
  params.set("beat", beatId);
  if (options && "detailRepo" in options) {
    if (options.detailRepo) params.set("detailRepo", options.detailRepo);
    else params.delete("detailRepo");
  }
  const qs = params.toString();
  return `/beats${qs ? `?${qs}` : ""}`;
}
