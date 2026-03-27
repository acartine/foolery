export function formatDisplayVersion(
  version: string | null | undefined,
): string {
  const normalized = version?.trim().replace(/^v+/i, "") ?? "";
  return `v${normalized}`;
}
