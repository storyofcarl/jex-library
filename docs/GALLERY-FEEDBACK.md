# Gallery Feedback — bugs found by visual testing (2026-06-24)

Carl ran the `preview/` gallery and found issues the automated gates missed (they're visual/layout,
no visual-regression gate exists). Track + fix here.

## 1. Tree-mode grid demo error — FIXED
- **Symptom:** "demo error: TreeFeature requires the grid data source to be a TreeStore."
- **Cause:** `preview/gallery.js` passed a plain array with `treeMode:true`; `RowModel` wrapped it as a
  flat `Store`, so `TreeFeature` (correctly) threw.
- **Fix (done):** gallery now passes `new TreeStore({ data: treeRows })`. (Isolated — no package rebuild.)
- **Optional DX follow-up:** Grid could auto-wrap a plain array into a `TreeStore` when `treeMode` is on
  (it already auto-wraps arrays into a flat `Store`). Nice-to-have, not required.

## 2. Grid headers misaligned — FIXED ✓ (packages/grid)
- **Symptom:** header columns drift out of alignment with body columns.
- **Root cause (confirmed):** `grid.ts` resize path — `ResizeObserver → measureAndMaybeRefresh() →
  scheduleRefresh() → paint()` calls only `renderViewport()` (body). It never re-renders the header.
  So when flex column widths are recomputed after the container is first measured (or on any resize),
  the body gets correct widths but the header keeps its mount-time widths.
- **Fix (apply after the Pivot/Spreadsheet workflow finishes, then rebuild grid):**
  in the resize observer callback, re-render the header when the size change altered the layout:
  `if (this.measureAndMaybeRefresh()) { this.rerenderHeader(); this.scheduleRefresh(); }`
  (Column resize/reorder already call `rerenderHeader()`; this closes the auto-flex-on-resize gap.)

## 3. TimePicker / DateTimeField "off" — FIXED ✓ (packages/widgets)
- **Symptom:** time pickers are positioned/laid out wrong in `TimePicker` and `DateTimeField`.
- **Cause:** not yet diagnosed — likely dropdown/popover positioning or internal layout. Investigate the
  TimePicker component + how DateTimeField composes it.
- **Fix:** after the running workflow finishes; rebuild widgets; verify in gallery.

## 4. RichText exit-format — FIXED ✓ (packages/widgets)
- **Symptom:** once inside a list / blockquote / code block / link, you can't leave it — Enter keeps
  continuing the format (and typing after a link keeps extending the link) instead of returning to a
  normal paragraph.
- **Cause:** not yet diagnosed — RichText "exit format" handling. Needs: Enter on an empty list item /
  at end of blockquote/codeblock should break out to a `<p>`; double-Enter exits; typing past a link
  boundary should not extend the anchor. Investigate the RichText command/keydown layer.
- **Fix:** after the running workflow finishes; rebuild widgets; verify in gallery.

## 5. Popover fields clipped (ALL pickers) — FIXED ✓ (routed through Popup; popover-clipping.browser.test.ts)
- **Symptom:** DatePicker's calendar (and likely TimePicker/ComboBox/Select/ColorPicker dropdowns) renders
  inside the field container and is clipped by ancestor `overflow` instead of floating above everything.
- **Root cause (architectural):** Wave-1 clusters were built self-contained (no cross-cluster imports during
  parallel build), so each popover-field rolled its OWN inline dropdown instead of using the `Popup` overlay
  (built in the separate `overlays` cluster) that portals to a body-level layer + flips on collision.
- **Fix (cross-cutting):** route DatePicker, TimePicker, DateTimeField, ComboBox, Select, ColorPicker through
  the `Popup` primitive (or a shared portal/overlay layer) so dropdowns escape overflow + position with flip.
  Audit ALL popover-based widgets, not just DatePicker. Larger than #2-#4 — touches several components.
- **Relates to #3** (TimePicker/DateTimeField "off" may be the same dropdown-positioning root cause).

## Apply-order
Wait for the Pivot/Spreadsheet workflow (wf_316da4b6-b05) to complete, then fix #2 (grid), #3 + #4
(widgets) → rebuild grid + widgets → `pnpm build && pnpm test` green → gallery reflects fixes on refresh.
Consider adding a visual/interaction-regression smoke to grid/widgets quality so these layout/behavior
regressions are caught automatically (they all slipped past unit + axe + token gates).
