# Changesets

This repository uses [Changesets](https://github.com/changesets/changesets) to manage release notes and semantic version bumps.

Create a changeset for user-visible changes:

```bash
bun run changeset
```

On merge to `main`, the Changesets workflow opens (or updates) a release PR. Merging that PR tags and publishes a GitHub release.
