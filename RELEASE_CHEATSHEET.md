# Release Cheatsheet

Current release flow (simple):

1. Generate a changeset in your feature branch/PR:

```bash
bun run changeset
```

Pick the bump type:
- `patch` = bug fix / small backward-compatible change
- `minor` = new backward-compatible feature
- `major` = breaking change

2. Merge to `main`.

The Changesets workflow opens/updates a `chore: release` PR. Merge that release PR so `package.json` and `CHANGELOG.md` are updated on `main`.

3. Publish the GitHub release manually (from repo root on `main`):

```bash
gh release create "v$(node -p \"require('./package.json').version\")" --target main --generate-notes --latest
```

That release event triggers runtime artifact publishing.
