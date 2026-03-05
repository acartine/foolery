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

interface BuildBeatFocusHrefOptions {
  detailRepo?: string | null;
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
  params.set("beat", beatId);
  if (options?.detailRepo) {
    params.set("detailRepo", options.detailRepo);
  }
  const qs = params.toString();
  return `/beats${qs ? `?${qs}` : ""}`;
}
