# scripts

Build, release, and setup scripts for Foolery.

## Key Files

- **`setup.sh`** — First-time project setup (dependencies, config)
- **`install.sh`** — Install the `foolery` CLI launcher onto the system PATH
- **`build-cli.sh`** — Build the CLI entry point
- **`build-runtime-artifact.sh`** — Build a self-contained runtime artifact for distribution
- **`release.sh`** — Cut a release from the current state
- **`release-from-package-version.sh`** — Tag and release using the version from `package.json`
- **`agent-wizard.sh`** — Interactive wizard for configuring agent settings
- **`setup-beats-dolt-hooks.sh`** — Install Dolt-native git hooks for Beads sync
- **`check-coverage.mjs`** — Verify test coverage thresholds
- **`test-doctor-stream.sh`** — Smoke test for the doctor streaming endpoint
- **`test-start-restart-settings.sh`** — Smoke test for settings load on startup

## Subdirectories

- **`release/`** — Release channel management (`channel-install.sh`, `channel-use.sh`)
