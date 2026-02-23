# Foolery Settings

User-level configuration stored as TOML at `~/.config/foolery/settings.toml`.

## Current Settings

| Key             | Type   | Default    | Description                                               |
|-----------------|--------|------------|-----------------------------------------------------------|
| `agent.command` | string | `"claude"` | CLI command used to spawn agent sessions                  |
| `backend.type`  | enum   | `"auto"`   | Backend selection (`auto`, `cli`, `stub`, `beads`, `knots`) |

## File Format

```toml
[agent]
command = "claude"

[backend]
type = "auto"
```

Settings use TOML sections (e.g. `[agent]`) for namespacing. New categories of settings get their own section.

## How to Add a New Setting

### 1. Add the Zod schema (with a default)

In `src/lib/schemas.ts`, extend the appropriate section schema or create a new one:

```typescript
// Adding to an existing section:
export const agentSettingsSchema = z.object({
  command: z.string().min(1).default("claude"),
  timeout: z.number().positive().default(300),  // ← new field
});

// Or creating a new section:
export const uiSettingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).default("system"),
});

// Then add it to the top-level schema:
export const foolerySettingsSchema = z.object({
  agent: agentSettingsSchema.default({ command: "claude" }),
  ui: uiSettingsSchema.default({ theme: "system" }),  // ← new section
});
```

**Important**: Always provide explicit defaults in both the field (`.default(...)`) and the top-level section (`.default({...})`). Zod v4 does not cascade inner field defaults when the section-level default is `{}`.

### 2. Use it in server-side code

```typescript
import { loadSettings } from "@/lib/settings";

const settings = await loadSettings();
const theme = settings.ui.theme;
```

Or add a convenience helper in `src/lib/settings.ts`:

```typescript
export async function getTheme(): Promise<string> {
  const settings = await loadSettings();
  return settings.ui.theme;
}
```

### 3. Add a UI field in the settings sheet

In `src/components/settings-sheet.tsx`, add the field to the form JSX and update the `DEFAULTS` constant and `SettingsData` interface.

### 4. Update this document

Add the new setting to the table at the top of this file.

## Architecture Notes

- **Storage**: TOML file on disk, not localStorage. Survives browser clears.
- **Caching**: Server-side settings are cached in memory for 30 seconds (TTL).
- **API**: `GET /api/settings` returns the current config, `PUT /api/settings` merges a partial update.
- **Defaults**: If the TOML file is missing or a key is absent, Zod defaults apply automatically.
- **Comments**: Saving settings through the UI will not preserve hand-written TOML comments.
