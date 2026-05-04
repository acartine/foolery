export type VersionStatusData = {
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
};

type VersionStatusResponse = {
  ok?: boolean;
  data?: {
    installedVersion?: string | null;
    latestVersion?: string | null;
    updateAvailable?: boolean;
  };
};

function cleanVersion(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  return value ? value : null;
}

export async function fetchVersionStatus(options?: {
  force?: boolean;
  signal?: AbortSignal;
}): Promise<VersionStatusData | null> {
  const suffix = options?.force ? "?force=1" : "";
  const res = await fetch(`/api/version${suffix}`, {
    method: "GET",
    signal: options?.signal,
  });
  if (!res.ok) return null;

  const json = (await res.json()) as VersionStatusResponse;
  const installedVersion =
    cleanVersion(json.data?.installedVersion ?? null);
  const latestVersion =
    cleanVersion(json.data?.latestVersion ?? null);
  const updateAvailable = Boolean(
    json.data?.updateAvailable &&
      installedVersion &&
      latestVersion,
  );

  return {
    installedVersion,
    latestVersion,
    updateAvailable,
  };
}
