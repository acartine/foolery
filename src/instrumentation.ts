export const runtime = "nodejs";

/**
 * Next.js startup hook (runs once per server process).
 * Ensures newly-added settings are backfilled for existing installs,
 * and builds the agent message type index when it is missing.
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
    const { backfillMissingRepoMemoryManagerTypes } = await import("@/lib/registry");
    const result = await backfillMissingRepoMemoryManagerTypes();
    if (result.error) {
      console.warn(`[registry] startup memory manager backfill skipped: ${result.error}`);
    } else if (result.changed) {
      const count = result.migratedRepoPaths.length;
      console.log(
        `[registry] backfilled memory manager metadata for ${count} repos in ~/.config/foolery/registry.json.`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[registry] startup memory manager backfill failed: ${message}`);
  }

  try {
    const {
      readMessageTypeIndex,
      buildMessageTypeIndex,
      writeMessageTypeIndex,
    } = await import("@/lib/agent-message-type-index");
    const existing = await readMessageTypeIndex();
    if (!existing) {
      console.log(
        "[message-types] Building agent message type index from recent logs...",
      );
      const index = await buildMessageTypeIndex();
      await writeMessageTypeIndex(index);
      const count = index.entries.length;
      console.log(
        `[message-types] Built index with ${count} message type${count === 1 ? "" : "s"}.`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[message-types] startup index build failed: ${message}`);
  }
}
