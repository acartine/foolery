export function stripBeatPrefix(beatId: string): string {
  return beatId.replace(/^[^-]+-/, "");
}

export function firstBeatAlias(aliases?: readonly string[]): string | undefined {
  return aliases?.find((alias) => alias.trim().length > 0)?.trim();
}

export function displayBeatLabel(
  id: string,
  aliases?: readonly string[],
): string {
  return firstBeatAlias(aliases) ?? stripBeatPrefix(id);
}
