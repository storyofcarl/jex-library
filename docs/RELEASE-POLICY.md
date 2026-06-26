# Release policy

## Versioning

Jects UI follows [Semantic Versioning](https://semver.org). All packages in the suite are released
together under a single version line so that cross-package compatibility is guaranteed for a given
version.

- **Major (`x`.0.0)** — breaking API changes.
- **Minor (0.`x`.0)** — backward-compatible features.
- **Patch (0.0.`x`)** — backward-compatible fixes.

Versions below `1.0.0` are pre-release: minor versions may include breaking changes, called out in the
changelog. See [`STATUS.md`](./STATUS.md) for per-module maturity.

## Cadence

- **Patch** releases as needed for fixes and security.
- **Minor** releases on a regular cycle for features and non-breaking improvements.
- **Major** releases are infrequent and accompanied by an upgrade guide.

## Changesets & changelog

Changes are tracked with [Changesets](https://github.com/changesets/changesets). Every user-facing
change carries a changeset describing it; the published `CHANGELOG.md` is generated from these and
groups entries as Added / Changed / Fixed / Security / Performance / Breaking.

## Deprecation

- Deprecated APIs are marked in TypeScript (`@deprecated`) and the changelog, and continue to work for
  at least one minor cycle before removal in a major release.
- Breaking changes are documented with migration notes.

## Supported versions

The latest major version receives features, fixes, and security updates. Once `1.0` is reached, the
previous major version receives security and critical fixes for a defined window after a new major
ships. Pre-`1.0`, only the latest minor line is supported.

## Security releases

Security fixes are prioritized and may ship out of the regular cadence as a patch. See
[`SECURITY.md`](./SECURITY.md) for the reporting process.
