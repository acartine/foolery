# Foolery

**A keyboard-first control room for multi-agent software work.**

Foolery helps you capture work, break it down, dispatch agents, review what they did, and keep the whole thing legible across repositories.

[![Latest Release](https://img.shields.io/github/v/release/acartine/foolery?style=for-the-badge)](https://github.com/acartine/foolery/releases)
[![License](https://img.shields.io/github/license/acartine/foolery?style=for-the-badge)](https://github.com/acartine/foolery/blob/main/LICENSE)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/acartine/foolery/coverage/coverage.json&style=for-the-badge)](https://github.com/acartine/foolery/actions/workflows/coverage.yml)
[![Join thecartine Discord](https://img.shields.io/badge/Discord-Join%20thecartine-5865F2?logo=discord&logoColor=white)](https://discord.gg/KPgNPMAzrP)

<table align="center">
  <tr>
    <td align="center">
      <a href="docs/screenshots/queues-20260427.png">
        <img src="docs/screenshots/queues-20260427.png" width="160" alt="Queues View" />
      </a>
      <br />
      <sub><b>Queues</b></sub>
    </td>
    <td align="center">
      <a href="docs/screenshots/active-20260427.png">
        <img src="docs/screenshots/active-20260427.png" width="160" alt="Active View" />
      </a>
      <br />
      <sub><b>Active</b></sub>
    </td>
    <td align="center">
      <a href="docs/screenshots/retakes-20260427.png">
        <img src="docs/screenshots/retakes-20260427.png" width="160" alt="Retakes" />
      </a>
      <br />
      <sub><b>Retakes</b></sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <a href="docs/screenshots/history-20260427.png">
        <img src="docs/screenshots/history-20260427.png" width="160" alt="History" />
      </a>
      <br />
      <sub><b>History</b></sub>
    </td>
    <td align="center">
      <a href="docs/screenshots/hot-keys-20260427.png">
        <img src="docs/screenshots/hot-keys-20260427.png" width="160" alt="Hot Keys" />
      </a>
      <br />
      <sub><b>Hot Keys</b></sub>
    </td>
  </tr>
</table>

Foolery is a local orchestration app for agent-driven software work. It sits on top of memory-manager backends — primarily [Knots](https://github.com/acartine/knots), with [Beads](https://github.com/steveyegge/beads) also supported — and gives you one place to stage work, run agents, and review outcomes across repos.

It is not trying to be just another chat box around a coding model. The point is to make multi-step work visible: what is queued, what is active, what is ready for review, and what happened in the session history.

[Read the Substack post on why I built it.](https://open.substack.com/pub/thecartine/p/foolery-the-app?r=1rb8nt&utm_campaign=post&utm_medium=web&showWelcomeOnShare=true)

## Install

### Prerequisites

You need:
- [Node.js](http://nodejs.org)
- [curl](http://curl.se)
- [tar](http://www.gnu.org/software/tar/)
- at least one supported memory manager CLI:
  - [Knots](https://github.com/acartine/knots) (`kno`) — primary path
  - [Beads](https://github.com/steveyegge/beads) (`bd`)

### 1. Install Foolery

```bash
curl -fsSL https://raw.githubusercontent.com/acartine/foolery/main/scripts/install.sh | bash
```

### 2. Make sure the launcher is on your PATH

If `~/.local/bin` is not already on your `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### 3. Run setup

```bash
foolery setup
```

`foolery setup` hands the [`foolery-configure` skill](.claude/skills/foolery-configure/SKILL.md) to the first agent CLI it finds on your PATH (`claude`, `codex`, `opencode`, `gemini`, `copilot`; override with `FOOLERY_SETUP_AGENT=<name>`). The agent walks you through:

- discovering repos
- detecting available memory-manager backends
- scanning for installed agent CLIs
- writing a validated `~/.config/foolery/settings.toml` and `registry.json`

If no supported agent CLI is installed, `foolery setup` exits with a clear error listing the expected CLIs and points you at the UI fallback: run `foolery start && foolery open`, then configure via **Settings**.

### 4. Start Foolery

```bash
foolery start
```

That launches the local server, opens the app in your browser, and leaves the backend running in the background.

## Supported Agent CLIs

Foolery launches and monitors agent sessions through their CLIs. It auto-detects installed agents and adapts its command invocation, output parsing, and terminal display per dialect.

| Agent | CLI Command | Notes |
|-------|-------------|-------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `claude` | Default dialect. Streams JSONL via `--output-format stream-json`. |
| [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/use-the-github-copilot-coding-agent-in-the-cli) | `copilot` | Uses prompt mode with JSON streaming and supports Claude, GPT, and Gemini model selections. |
| [Codex](https://github.com/openai/codex) | `codex` | Uses `exec` subcommand with `--json` output. ChatGPT CLI variants also supported. |
| [OpenCode](https://github.com/opencode-ai/opencode) | `opencode` | Uses `run` subcommand with `--format json` output. |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `gemini` | Auto-detected and displayed in agent identity. |

Foolery scans your `$PATH` for these CLIs during setup and in **Settings > Agents**. You can register additional agent commands or override defaults there.

## Dispatch Modes

Foolery supports two dispatch modes for assigning agents to work, configurable under **Settings > Dispatch**.

### Simple (One agent per action)

Map one registered agent to each action type: **Take!** (execute a single beat) and **Scene!** (multi-beat orchestration). If you want to change your default agent, the Swap Agent tool updates all matching mappings at once.

![Simple dispatch](docs/screenshots/dispatch-simple-20260427.png)

### Advanced (Weighted pools per step)

Assign weighted agent pools to each workflow step: Planning, Plan Review, Implementation, Implementation Review, Shipment, and Ship Review. Foolery picks from each pool according to the weights, which makes it useful for A/B testing models, mixing agent strengths, or spreading work across different tools. The Swap Agent tool still works across the whole dispatch configuration.

![Advanced dispatch](docs/screenshots/dispatch-advanced-20260427.png)

## Flow & Features

### Queues

The default view. All beats queued and ready for action — filter by type, priority, or free-text search. Select rows with spacebar, bulk-update fields, drill into inline summaries, and trigger agent sessions on any beat. Create new beats with Shift+N.

![Queues view](docs/screenshots/queues-20260427.png)

### Active

Beats currently in progress. See which agents are working, their model, version, and state at a glance. The Active view adds Agent, Model, and Version columns so you can monitor running work.

![Active view](docs/screenshots/active-20260427.png)

### Retakes

The review lane for shipped beats. Browse handoff capsules from agent sessions, inspect what changed, and trigger follow-up passes when something needs another look.

![Retakes view](docs/screenshots/retakes-20260427.png)

### History

A focused history feed for agent sessions. Browse recent beat activity, inspect beat metadata, and review app-to-agent and agent-to-app conversation logs in one timeline.

![History view](docs/screenshots/history-20260427.png)

### Diagnostics

The Diagnostics view splits into two tabs: Runtime for local perf telemetry
such as heap churn, long tasks, render commits, and fetch timings, and Leases
for lease analytics and agent throughput history.

### Hot Keys

Need to stay in flow? Open the keyboard shortcut overlay (Shift+H) for a quick map of navigation, actions, editing, and panel controls across views.

![Keyboard shortcuts overlay](docs/screenshots/hot-keys-20260427.png)

## Why Foolery?

- **Keep software work legible.** See what is queued, running, ready for review, and already discussed.
- **Turn loose tasks into structured execution.** Break work into beats, stage dependency-aware waves, and run agents without losing the plot.
- **Review outcomes instead of trusting vibes.** Finished work lands in a review lane before it counts as done.
- **Stay fast without living in terminal tabs.** Navigate, select, bulk-update, and launch work from a keyboard-first interface.
- **Work across repos from one place.** Keep the orchestration layer above any single repository.

## How to Contribute

[![Join thecartine Discord](https://img.shields.io/badge/Discord-Join%20thecartine-5865F2?logo=discord&logoColor=white)](https://discord.gg/KPgNPMAzrP)

See the **[Developer Guide](docs/DEVELOPING.md)** for architecture, conventions, testing, and contribution guidelines.
For the project's shared vocabulary (Beats, Knots, Waves, Scenes, Takes, etc.) see **[TAXONOMY.md](TAXONOMY.md)**.
For backend authors, see **[Foolery Agent Memory Contract](docs/FOOLERY_AGENT_MEMORY_CONTRACT.md)**.
For Knots compatibility decisions, see **[Knots Compatibility ADR](docs/adr-knots-compatibility.md)**.
For clones that use Dolt-native Beads sync hooks, run `bash scripts/setup-beads-dolt-hooks.sh` once and see **[docs/BEADS_DOLT_HOOKS.md](docs/BEADS_DOLT_HOOKS.md)**.


## Key Shortcuts
Shift+H to view at any time!

| Shortcut | Action |
|----------|--------|
| `↑ / ↓` | Navigate rows |
| `Space` | Select row & advance |
| `Shift+]` / `Shift+[` | Next / previous view |
| `Shift+R` / `⌘+Shift+R` | Next / previous repository |
| `Shift+S` | Take! (start agent session) |
| `Shift+C` | Close focused beat |
| `Shift+<` / `Shift+>` | Fold / unfold parent |
| `Shift+O` | Open notes dialog |
| `Shift+L` | Add label to focused beat |
| `Shift+N` | Create new beat |
| `Shift+T` | Toggle terminal panel |
| `Shift+H` | Toggle shortcut help |

## Commands
```bash
➜ ~ foolery --help
Usage: foolery <command>

Commands:
  start     Start Foolery in the background and open browser
  open      Open Foolery in your browser (skips if already open)
  setup     Configure repos and agents interactively
  prompt    Manage Foolery guidance prompt in AGENTS.md/CLAUDE.md
  update    Download and install the latest Foolery runtime
  stop      Stop the background Foolery process
  restart   Restart Foolery
  status    Show process/log status
  doctor    Run diagnostics (--fix to auto-fix issues)
  uninstall Remove Foolery runtime, logs/state, and launcher
  help      Show this help
➜ ~
```

## Tech Stack

Next.js 16 / React 19 / TypeScript / Tailwind CSS 4 / Zustand / TanStack Query / xterm.js

## License

MIT
