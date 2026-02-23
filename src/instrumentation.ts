export const runtime = "nodejs";

/**
 * Next.js startup hook (runs once per server process).
 * Ensures newly-added settings are backfilled for existing installs.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  try {
    const { backfillMissingSettingsDefaults } = await import("@/lib/settings");
    const result = await backfillMissingSettingsDefaults();
    if (result.error) {
      console.warn(`[settings] startup backfill skipped: ${result.error}`);
    } else if (result.changed) {
      const count = result.missingPaths.length;
      console.log(
        `[settings] backfilled ${count} missing setting${count === 1 ? "" : "s"} in ~/.config/foolery/settings.toml.`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[settings] startup backfill failed: ${message}`);
  }

  try {
    const { backfillMissingRepoTrackerTypes } = await import("@/lib/registry");
    const result = await backfillMissingRepoTrackerTypes();
    if (result.error) {
      console.warn(`[registry] startup tracker backfill skipped: ${result.error}`);
    } else if (result.changed) {
      const count = result.migratedRepoPaths.length;
      console.log(
        `[registry] backfilled issue tracker metadata for ${count} repos in ~/.config/foolery/registry.json.`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[registry] startup tracker backfill failed: ${message}`);
  }
}
