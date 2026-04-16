# scripts

Build, release, and setup scripts for Foolery.

## Setup & Install

- **`setup.sh`** — First-time project setup (dependencies, interactive config)
- **`install.sh`** — Install the `foolery` CLI launcher onto the system PATH
- **`agent-wizard.sh`** — Legacy interactive wizard for configuring agent settings
- **`model-picker.sh`** — Searchable model-picker helper used by setup
- **`toml-reader.sh`** — TOML reader used by setup and agent-wizard
- **`setup-git-hooks.sh`** — Point `core.hooksPath` at the committed `.githooks/` directory

## Build & Release

- **`build-cli.sh`** — Build the CLI entry point
- **`build-runtime-artifact.sh`** — Build a self-contained runtime artifact for distribution
- **`release.sh`** — Cut a release from the current state
- **`release-from-package-version.sh`** — Tag and release using the version from `package.json`

## Quality Gates

- **`lint-staged-size.sh`** — Run ESLint on staged `src/**/*.ts(x)` files before commit
- **`check-coverage.mjs`** — Verify test coverage thresholds
- **`collect-perf-baseline.mjs`** — Capture a performance baseline snapshot

## Smoke Tests

Shell drivers with matching `.mjs` implementations for interactive/browser paths:

- **`test-doctor-stream.sh`** — Doctor streaming endpoint
- **`test-start-restart-settings.sh`** — Settings load on startup
- **`test-copilot-settings-ui.{sh,mjs}`** — Copilot scan/import in Settings
- **`test-install-copilot-setup.sh`** — Isolated installer smoke test for Copilot setup
- **`test-setup-scan-unmounted.sh`** — Setup scan handling of unmounted repos
- **`test-beat-refresh-latency.{sh,mjs}`** — Beat list refresh latency check
- **`test-queue-pulldown-stability.{sh,mjs}`** — Queue pulldown stability under load
- **`test-terminal-rehydration-multicontext.{sh,mjs}`** — Terminal rehydration across contexts
- **`test-model-picker.sh`**, **`test-model-picker-integration.sh`** — Model picker unit and integration coverage

## Subdirectories

- **`release/`** — Release channel management (`channel-install.sh`, `channel-use.sh`)
- **`test-fixtures/`** — Deterministic offline fixtures for smoke tests
