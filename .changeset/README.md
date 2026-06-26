# Changesets

This folder holds [Changesets](https://github.com/changesets/changesets) — one short file per
user-facing change. They drive both the version bump and the generated `CHANGELOG.md`.

## Adding a changeset

Run `pnpm changeset`, pick the affected packages and a bump level, and write a clear,
user-facing summary. All `@jects/*` packages move on one shared version line.

## Bump levels (SemVer)

- **patch** — backward-compatible bug fix.
- **minor** — backward-compatible feature. (Pre-1.0, a minor may include a breaking change;
  call it out explicitly in the summary.)
- **major** — breaking API change, accompanied by migration notes.

## Writing the summary

Group the change under one of: **Added**, **Changed**, **Fixed**, **Security**,
**Performance**, or **Breaking**. State what changed from the user's perspective and, for
breaking changes, how to migrate. Avoid internal process notes.

## Releasing

`pnpm version-packages` applies pending changesets (bumps versions + updates the changelog);
`pnpm release` builds and publishes. See [`docs/RELEASE-POLICY.md`](../docs/RELEASE-POLICY.md).
