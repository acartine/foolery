# /ship-release

Cut a new release of foolery.

## Steps

1. **Determine bump type** — Ask the user whether this is a `patch`, `minor`, or `major` release unless they already specified (e.g., `/ship-release patch`). Show them the current version and what each bump would produce.

2. **Preview changes** — Run `git log $(git describe --tags --abbrev=0)..HEAD --oneline` to show commits since the last release tag. Present a brief summary so the user can confirm.

3. **Run quality gates** — Execute in parallel:
   - `bun run lint`
   - `bunx tsc --noEmit`
   - `bun run test`
   - `bun run build`

   If any gate fails, stop and report. Do not proceed with a broken release.

4. **Cut the release** — Run: `bun run release -- --<bump_type> --wait-for-artifacts`

   This bumps `package.json`, commits, tags, pushes, creates a GitHub Release with auto-generated notes, and waits for the "Release Runtime Artifact" workflow to finish and verifies assets are published.

5. **Report** — Show the user the new version, link to the GitHub Release, and confirm artifacts are available.
