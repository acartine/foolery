export function formatDisplayVersion(
  version: string | null | undefined,
  fallback = "unknown",
): string {
  const normalized = version?.trim().replace(/^v+/i, "") ?? "";
  if (!normalized) return fallback;
  return `v${normalized}`;
}
