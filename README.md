# Foolery

**Product-focused agentic orchestration tool** — one layer up from managing 8 agent terminals, one level down from massively multi-agent chaos.

Foolery is a local web UI that sits on top of [Beads](https://github.com/steveyegge/beads) issue tracking, giving you a visual control surface for organizing, orchestrating, and reviewing AI agent work across your repositories.

## Why Foolery?

- **Rapid scratch pad for small bugs and big ideas alike.** Create a beat, fire off an agent, review the result — all without leaving the keyboard.
- **Leverage agents to organize groups of work and optimize them for parallel execution.** Ask Claude to decompose a set of tasks into dependency-aware waves, then launch them scene by scene.
- **Track "completed" work units in a first-class way — accept or reject them with notes.** Every finished beat flows into a verification queue where you approve, reject, or annotate before it's truly done.
- **Keyboard-first workflow.** Navigate, select, bulk-update, and trigger agent sessions entirely from the keyboard.
- **Dependency-aware wave planning.** Visualize what's runnable, what's blocked, and what's next — across your whole project.
- **Multi-repo support.** Switch between repositories or view beats across all of them in one place.

## Install (App Mode)

**Prerequisites:** [Node.js](https://nodejs.org), [curl](https://curl.se), [tar](https://www.gnu.org/software/tar/), and [Beads](https://github.com/steveyegge/beads) (`bd` CLI).

```bash
curl -fsSL https://raw.githubusercontent.com/acartine/foolery/main/scripts/install.sh | bash
```

The installer downloads the latest prebuilt GitHub Release runtime artifact for your platform and writes a launcher to `~/.local/bin/foolery`.
Bun is not required for installed app usage.

If `~/.local/bin` is not on your `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Run Foolery like an app:

```bash
foolery start
foolery open
foolery stop
foolery restart
foolery status
foolery uninstall
```

`foolery start` launches the backend in the background, prints log paths, opens your browser automatically, and returns immediately.
`foolery open` opens Foolery in your browser without spawning duplicate tabs when one is already open.
Default logs are in `~/.local/state/foolery/logs/stdout.log` and `~/.local/state/foolery/logs/stderr.log`.
`foolery uninstall` removes the runtime bundle, local state/logs, and the launcher binary.
The launcher also shows an update banner when a newer Foolery release is available.

To install a specific release tag instead of latest:

```bash
FOOLERY_RELEASE_TAG=v0.1.0 curl -fsSL https://raw.githubusercontent.com/acartine/foolery/main/scripts/install.sh | bash
```

Re-run the same install command to upgrade/reinstall.

Foolery reads from whatever Beads-enabled repos you register. If you don't have one yet:

```bash
cd your-project
bd init
```

## Development

```bash
git clone https://github.com/acartine/foolery.git
cd foolery
bun install
bun run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Release

Create and publish a GitHub release from `main`:

```bash
bun run release -- v0.1.1
```

This runs `gh release create <tag> --target main --generate-notes --latest` and triggers the runtime artifact workflow.

## Views

### Beats

The main table. See every beat at a glance — filter by status, type, priority, or free-text search. Select rows with spacebar, bulk-update fields, drill into inline summaries, and trigger agent sessions on any beat.

![Beats view](docs/screenshots/beats.png)

### Scenes

Browse and manage your orchestration trees. Navigate dependency hierarchies with keyboard arrows, zoom in/out on wave depth, rename slugs, and trigger execution on any wave with a single shortcut.

![Scenes view](docs/screenshots/scenes.png)

### Direct

The planning room. Select a set of beats and ask Claude to organize them into dependency-aware scenes. Watch the plan stream in real time, edit wave names and agent counts, then apply the whole orchestration with one click.

![Direct view](docs/screenshots/direct.png)

### Final Cut

The verification queue. Every beat labeled `stage:verification` lands here. Review each one, approve it, or reject it with notes — keeping your done list honest.

![Final Cut view](docs/screenshots/final-cut.png)

## Key Shortcuts

| Shortcut | Action |
|----------|--------|
| `↑ / ↓` | Navigate rows |
| `Space` | Select row & advance |
| `Shift+]` / `Shift+[` | Next / previous view |
| `Shift+S` | Take! — start agent session on focused beat |
| `Shift+V` | Verify (close) focused beat |
| `Shift+F` | Reject focused beat |
| `Shift+O` | Open notes dialog |
| `Shift+N` | Create new beat |
| `Shift+T` | Toggle terminal panel |
| `Shift+H` | Toggle shortcut help |

## Tech Stack

Next.js 16 / React 19 / TypeScript / Tailwind CSS 4 / Zustand / TanStack Query / xterm.js

## License

MIT
