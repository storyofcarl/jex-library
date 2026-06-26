# Enriched Theme Customizer — Scope

> Scope for upgrading the `#customizer` route from a thin color/radius/font panel into a
> full design-system control surface (the audit's "theme customizer export flow" differentiator).
> Grounded in the actual `--jects-*` token system (see `docs/modules/tokens.md`).

## 1. Current state & gap

**Today the customizer edits:** base theme (light/dark/hc), 4 colors (primary/accent/fg/bg, now with hex),
single radius, font family, base font size (full scale), one spacing step. Live preview (buttons/fields/grid/chart),
`theme.css` export, reset.

**Gaps the user called out:** not granular enough; **no padding**, **no outline/border**, **no table** options.

**Root cause (the blocker):** the suite has only **two token tiers** — primitive + semantic. There is **no
component-token tier**, so padding, control height/density, border width, focus-ring width/offset, and
table styling are **hardcoded in component CSS** (e.g. Button: `border: 1px`, `outline: 2px; outline-offset: 2px`,
padding from `--jects-space-*`). The customizer literally has nothing to bind padding/outline/table controls to.
**Enabling work = introduce a component-token tier**, then the customizer can expose it.

## 2. Enabling work — a component-token tier (3rd tier)

Add component-level `--jects-*` tokens (defaults = current hardcoded values, so **zero visual change** on
adoption), and refactor components to consume them. Proposed set:

| Group | New tokens (defaults from today) | Consumed by |
| --- | --- | --- |
| **Controls / density** | `--jects-control-height` (2.25rem), `--jects-control-padding-x` (.75rem), `--jects-control-padding-y` (.375rem), `--jects-control-gap` | Button, fields, select, toolbar, etc. |
| **Borders** | `--jects-border-width` (1px) | every bordered surface (replaces hardcoded `1px`) |
| **Outline / focus** | `--jects-ring-width` (2px), `--jects-ring-offset` (2px) | every `:focus-visible` (replaces hardcoded `2px`) |
| **Density preset** | `--jects-density` scalar driving control-height/padding/row-height (compact/cozy/comfortable) | global |
| **Tables / data grid** | `--jects-table-cell-padding-x/y`, `--jects-table-row-height`, `--jects-table-header-bg`, `--jects-table-row-stripe`, `--jects-table-row-hover`, `--jects-table-border` | grid, pivot, spreadsheet, table-view (todo), scheduler/gantt locked columns |
| **Typography (extend)** | `--jects-line-height`, `--jects-letter-spacing` | body/components |

These belong in `@jects/tokens` (definitions + TS types) → `@jects/theme` base CSS, with each component CSS
refactored to read them. **Adoption is mechanical + non-breaking** (token default == current literal) but spans
many packages → the biggest, most careful piece.

## 3. Enriched customizer control inventory

Grouped, collapsible sections (search/filter across them):

1. **Base & presets** — light/dark/high-contrast + start-from-preset (bootstrap/refined/corporate); import an existing `theme.css`/paste tokens.
2. **Brand & semantic colors** — all 14 semantic pairs: background, foreground, card(+fg), popover(+fg), primary(+fg), secondary(+fg), muted(+fg), accent(+fg), destructive(+fg), success(+fg), warning(+fg), border, input, ring (color + hex each).
3. **Data & chart ramps** — `data-1…8` and the CMYK ramp (cyan/magenta/yellow/key + soft) — drives charts/diagram/status pills.
4. **Typography** — font family, mono family, base size (full scale), weights (normal/medium/semibold/bold), line-height, letter-spacing.
5. **Spacing & density** — spacing base/step (full `space-0…12` scale) + a **density** preset (compact/cozy/comfortable) → control height + padding + table row height.
6. **Radius** — base radius + the sm/md/lg/xl derivation.
7. **Borders & outlines** — **border width**, border color, **focus ring** color + **width** + **offset** (the user's "outline").
8. **Elevation** — shadow sm/md/lg intensity.
9. **Motion** — duration fast/normal/slow.
10. **Tables / data grids** — header background, row height, **cell padding**, zebra-stripe, row hover, grid border (the user's "table options").
11. **Component overrides (advanced)** — optional raw token editor for power users.

## 4. UX enrichment pass

- **Collapsible grouped sections** + a token **search/filter**.
- **Preset starting points** (light/dark/hc + bootstrap/refined/corporate) and **Import** (parse an existing `theme.css` or paste `--jects-*` overrides).
- **Expanded live preview**: more components + a **per-component preview selector**, and an optional **light/dark side-by-side** so both bases are checked at once.
- **Density toggle** wired to the new control/table tokens.
- **Accessibility checker**: live WCAG contrast ratios for each fg/bg pair with pass/fail badges.
- **Undo/redo** of token edits; **reset per section** (not just global).
- **Share/persist**: encode overrides in the URL hash (shareable link) + Copy/Download `theme.css` (already present).
- **Full export**: emit the complete overridden token set, with `:root` + a `.jects-dark` block when dark is customized.

## 5. Implementation plan (phased — me orchestrating, raw-verified, deployed per phase)

| Phase | Work | Owner | Risk | Acceptance |
| --- | --- | --- | --- | --- |
| **A** | Component-token tier: define tokens (tokens+theme), refactor each component CSS to consume them (defaults = current literals → no visual change). | `[WF]` per package | **Med-high** (touches many CSS files; must be visually inert) | Token-purity + existing browser/visual tests still green; a diff shows defaults equal old literals; 0 visual regressions on the gallery (headless before/after screenshot diff). |
| **B** | Customizer UI rebuild: collapsible grouped sections + search; all semantic colors + data/cmyk ramps + full typography/spacing/radius scales; presets + import; expanded/per-component preview; contrast checker; undo/redo; share-URL; full export. | `[AGENT]` (owns gallery customizer) | Med | Every group edits its tokens live; import round-trips; contrast badges correct; export contains the full set; 0 errors. |
| **C** | Wire the **padding/density**, **outline/border**, and **table** controls to the Phase-A tokens; per-component + density preview. | `[AGENT]` | Low (after A) | Changing padding/border-width/ring-width/table tokens visibly restyles the preview components (headless before/after proof). |
| **D** | Docs: make the customizer the canonical theming story; update `docs/modules/theme.md` + tokens.md with the component tier. | `[AGENT]` | Low | Docs match the shipped tokens. |

**Sequencing:** A is the gate (everything padding/outline/table depends on it). A is invasive but mechanical and
non-breaking; I'd do it as a per-package workflow with a visual-regression check (gallery screenshot diff) to prove
zero appearance change before/after. B can start in parallel for the color/scale controls (no A dependency); C
slots in once A lands.

**Effort:** A ≈ the largest (per-package CSS refactor + token defs); B medium; C small; D small. All deployable
incrementally to jexlibrary.vercel.app and raw-verified per phase.

## 6. Out of scope (for now)
Per-instance style props beyond tokens; a visual theme marketplace; saving named themes server-side (the share-URL
covers shareable state locally).
