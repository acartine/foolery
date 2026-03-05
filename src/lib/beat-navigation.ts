const BEAT_PREFIX_PATTERN = /^[^-]+-/;

/** Render beat IDs without repo prefix (e.g. "foolery-xmvb" -> "xmvb"). */
export function stripBeatPrefix(beatId: string): string {
  return beatId.replace(BEAT_PREFIX_PATTERN, "");
}

/** Extract the repo-name prefix from a beat ID (e.g. "foolery-xmvb" -> "foolery"). */
export function extractBeatPrefix(beatId: string): string | null {
  const match = beatId.match(/^([^-]+)-/);
  return match ? match[1] : null;
}

interface RepoMatch {
  name: string;
  path: string;
}

/**
 * Resolve which registered repo owns a beat ID by matching `<repo-name>-` prefix.
 * Uses the longest matching repo name so hyphenated repo names are handled correctly.
 */
export function findRepoForBeatId<T extends RepoMatch>(
  beatId: string,
  repos: readonly T[],
): T | null {
  let match: T | null = null;
  for (const repo of repos) {
    if (!beatId.startsWith(`${repo.name}-`)) continue;
    if (!match || repo.name.length > match.name.length) {
      match = repo;
    }
  }
  return match;
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
