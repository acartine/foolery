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
      return;
    }
    if (!result.changed) return;

    const count = result.missingPaths.length;
    console.log(
      `[settings] backfilled ${count} missing setting${count === 1 ? "" : "s"} in ~/.config/foolery/settings.toml.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[settings] startup backfill failed: ${message}`);
  }
}
