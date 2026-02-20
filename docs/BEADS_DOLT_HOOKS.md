# Beads Dolt Hook Setup (v0.55.1)

Use this when a Foolery clone needs Dolt-native Beads sync for standard `git push` and merge-style `git pull`.

## Run Once Per Clone

```bash
bash scripts/setup-beads-dolt-hooks.sh
```

The script:

- Sets `sync.git-remote` to the full URL for git remote `origin`
- Ensures Dolt remote `origin` exists in `dolt_remotes`
- Backs up existing hook files to `.bak-YYYYmmdd-HHMMSS`
- Replaces only:
  - `pre-push`
  - `post-merge`
  - `post-checkout`
- Leaves `pre-commit` and `prepare-commit-msg` untouched

## Hook Behavior

- `pre-push`
  - Resolves active Dolt branch via `bd sql --csv "SELECT active_branch()"`
  - Runs checkpoint commit: `bd vc commit -m "hook: pre-push dolt checkpoint"`
  - Ignores `nothing to commit`
  - Runs `bd sql "CALL DOLT_PUSH('origin','<branch>')"`
  - Exits non-zero on push failure
- `post-merge`
  - Resolves active Dolt branch
  - Runs `bd sql "CALL DOLT_PULL('origin','<branch>')"`
  - If pull fails with `cannot merge with uncommitted changes`, checkpoints once and retries once
  - Never blocks merge completion (warns and exits 0)
- `post-checkout`
  - No-op, exits 0

All custom hooks include markers expected by Beads hook diagnostics:

- `# bd-shim v1`
- `# bd-hooks-version: 0.55.1`

## Validation

Run these after setup:

```bash
bd hooks list
bd doctor
.git/hooks/pre-push
```

## Caveats

- Hook changes are local to each clone (`.git/hooks`), not committed history.
- `bd hooks install --force` will overwrite these custom hooks.
- `git pull --rebase` does not trigger `post-merge`; this applies to merge-style pull.
