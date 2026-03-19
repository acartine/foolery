export function stripBeatPrefix(beatId: string): string {
  return beatId.replace(/^[^-]+-/, "");
}

export function stripHierarchicalPrefix(alias: string): string {
  return alias.includes(".") ? stripBeatPrefix(alias) : alias;
}

export function firstBeatAlias(aliases?: readonly string[]): string | undefined {
  return aliases?.find((alias) => alias.trim().length > 0)?.trim();
}

export function displayBeatLabel(
  id: string,
  aliases?: readonly string[],
): string {
  const alias = firstBeatAlias(aliases);
  return alias ? stripHierarchicalPrefix(alias) : stripBeatPrefix(id);
}
