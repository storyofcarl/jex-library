# Changelog

All notable changes to Jects UI are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the suite follows
[Semantic Versioning](https://semver.org) with all `@jects/*` packages on one shared
version line (see [`docs/RELEASE-POLICY.md`](docs/RELEASE-POLICY.md)). Per-release entries are
generated from [Changesets](https://github.com/changesets/changesets); see
[`.changeset/README.md`](.changeset/README.md).

## [Unreleased]

## [0.8.0]

First public preview of the suite.

### Added
- Eighteen modules on one zero-dependency core: Grid, Pivot, Spreadsheet, Gantt,
  Scheduler, Calendar, Booking, Kanban, Todo, Charts, Diagram, Widgets, Chatbot,
  plus the Core / Tokens / Theme / Icons / Timeline-core foundation.
- React, Vue, Angular, and Web-Component wrappers over the uniform imperative API,
  with per-component subpath exports (e.g. `@jects/react/grid`).
- Real subpath exports on the larger engines (e.g. `@jects/grid/columns`,
  `@jects/widgets/overlays`, `@jects/gantt/io`).
- Token-driven theming (3-tier OKLCH) with a live customizer and `exportThemeCss()`.
- Documentation site with Demo / Docs / Code tabs, a product landing page, four
  flagship application demos, live performance benchmarks, a server-side-data demo,
  and an honest comparison page.
- HTML-sanitization layer (`sanitizeHtml`, `escape`, `SafeHtml`) with per-module XSS
  tests and a CI guard against unguarded `innerHTML`.
- Generated capability matrix (`docs/MATRIX.md` / `matrix.json`).

### Security
- All rich-HTML insertion points route through the sanitizer or are explicitly
  vetted; a CI gate fails the build on any unguarded raw HTML.
