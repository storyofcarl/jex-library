# Jects UI — Enterprise Parity Checklists

**"Done" = feature parity with the equivalent Bryntum / DHTMLX component.** Each depth-enrichment pass
audits the current implementation against the relevant list below, builds every MISSING feature, and
gates it (build/typecheck/test/lint/token-purity + axe a11y + a visual/interaction smoke that exercises
the new feature). Derived from the Bryntum + DHTMLX product research. `[have]` = already implemented in
the core build; everything unmarked must be audited and built if missing.

---

## Grid `@jects/grid`
Columns: typed (text/number/date/check/action/rating/widget/template/tree/rownumber) `[have core]`,
**locked/frozen + split regions** `[have]`, reorder/resize/autoWidth/rename, **column picker**,
**grouped/multi-level headers**, cell renderers `[have]`. Sort: single + **multi-column** `[have]`.
Filter: menu + **filter bar (inline)** `[have]`, faceted. Group: collapsible + **GroupSummary** +
footer **Summary** (sum/avg/min/max/count/custom). **Tree grid** mode `[have]`. Editing: **cell edit** +
**row edit**; editors text/number/date/combo/checkbox/custom-widget. **Row reorder** (incl. between grids),
**row resize**, **row expander / master-detail** (widget column). Selection: cell/row/**range** + checkbox
column + **copy/paste/fill**. **QuickFind / Search** highlight. **Merged cells / spans**. Menus: cell/header/
context. Cell tooltips. **Export: Excel + PDF + CSV + print**. Virtual/buffered rendering `[have]`,
**lazy/infinite load**. **State persistence** (column order/width/visibility/sort/group/filter). **Undo/redo**.
RTL, responsive, full keyboard + ARIA grid.
> **Integration note (depth pass 1):** grouping and row-expander/master-detail both drive the single engine
> row-source seam (`Grid.setRowSource`), so only one can own the body view at a time — installing both, the
> last-installed feature wins. Combined group+detail composition is a future enhancement. Merged cells auto-select
> the span-aware renderer when any column declares `column.meta.span`; an explicit `options.renderer` overrides.
> Declarative group aggregations: `features.group.aggregations` / `features.group.footerAggregations`.

## Gantt `@jects/gantt`  (audited 2026-06-24 — core present, tail missing)
`[have]` critical path, baselines, constraints, working calendars, dependencies + lag, deadlines, task tree/WBS, task editor, FS/SS/FF/SF.
**MISSING:** **Resource management** (assign people/equipment/cost, multi-resource) + **Resource Histogram** +
**Resource Utilization**; **Undo/redo (STM)**; **Export** PDF/PNG/Excel + **MS Project .mpp import/export** + ICS;
**Rollups** (child task rollup on parent bar); **Progress line / status line**; **Indicators**; **Split/segmented tasks**;
**PERT chart view**; explicit **ASAP/ALAP** scheduling modes; **multi-baseline compare**; column types (effort, rollup, predecessors/successors editor); **ProjectLines**; print.

## Scheduler `@jects/scheduler` + Pro
Time axis: ViewPresets (ms→years), PresetManager, zoom in/out/to-fit + custom levels, HeaderZoom,
non-continuous axis (collapse non-working). Resources: horizontal + vertical modes, grouping/tree, AssignmentStore
(multi-assignment), variable row height. Events: pack/stack/overlap layouts, renderer, predefined styles.
Interactions: drag/resize/dragCreate/dragSelect/copy-paste, **event editor**, drag from external unplanned grid.
**Dependencies** (visual + **Pro auto-reschedule**). **Recurrence (RRULE)**. **NonWorkingTime**, **TimeRanges**,
**ResourceTimeRanges**. Tooltips/menus. **Summary + histogram + Resource Utilization**. **Undo/redo**. Infinite scroll, Pan.
**Export PDF/PNG/Excel/ICS/print**. Pro: scheduling engine (constraints, multi-level calendars), **nested events**,
**split/segmented events**, **event buffer**, deadlines, travel time, partner schedulers (synced axis).

## Spreadsheet `@jects/spreadsheet`
`[have]` 150+ functions, dependency-graph recalc, cross-sheet refs, dynamic arrays/spill, multi-sheet, formula bar.
**MISSING/verify:** full **XLSX import/export** (styles + formulas), **conditional formatting** (rule engine),
**data validation** (dropdown/list/range), **frozen panes** `[have?]`, **merge cells** `[have?]`, **named ranges**,
**undo/redo**, **sorting/filtering**, **comments**, number-format masks, copy/paste block + auto-fill, cell protection,
**embedded charts** (via @jects/charts), CSV/JSON import-export.

## Diagram `@jects/diagram`
Modes flowchart/org/mind/PERT; 30+ shapes + custom HTML shapes; connectors straight/elbow/**orthogonal routing**
+ arrows/labels; **swimlanes**; **auto-layout orthogonal + radial**; no-code editor (toolbar + shapebar + **properties
panel**); drag/create/inline-edit; **multi-select + box-select**; **align + distribute** (6+); snap lines; copy/apply
style; search/filter; expand/collapse (mindmap); **groups**; **undo/redo**; **export PDF/PNG/JSON**; import JSON.

## Pivot `@jects/pivot`
Aggregations sum/count/counta/countunique/min/max/average/median/product/stddev/variance + **custom** `[have]`;
config panel rows/cols/values/filters drag-drop `[have]`; **tree + flat modes**; grand/row/col **totals** `[have]`;
type-aware filtering; frozen headers `[have, fixed]`; locale number formats; custom cell templates; **export XLSX + CSV**;
large-data (≥100k); collapsible headers; conditional cell formatting.

## Charts `@jects/charts`
13 types `[have]`; axes/scales linear/log/category/time + **dual axes** `[have]`; legend/tooltips `[have]`; stacking +
combination `[have]`; **zoom + pan**; **export PNG/SVG/PDF**; large-data averaging `[have]`; **real-time/streaming update**;
**annotations / target lines**; crosshair; data labels; click/hover events; gradient/monochrome.

## Calendar `@jects/calendar`
Views day/week/month/year/agenda/resource + **timeline** `[have core]`; **recurring events (RRULE)**; drag
create/move/resize; event editor `[have]`; multi-day/all-day; **timezones**; resource view; mini-calendar nav;
category + resource filtering; **export ICS/Excel/print**; load-on-demand; undo/redo; capacity/overlap rendering.

## Kanban / TaskBoard `@jects/kanban`
Columns + **swimlanes** `[have]`; **WIP limits (limit + strictLimit)** `[have]`; cards: tags/avatar/progress +
**attachments/cover/comments/votes/card-links** ; drag across columns/swimlanes + reorder + **multiselect** + touch +
auto-scroll `[have]`; card editor `[have]`; toolbar search/sort/filter; column collapse/lock/reorder; **undo/redo**;
**export**; REST/WebSocket data provider.

## Tree / TreeGrid (Grid tree mode)
Lazy load (PRO); drag with **drop-behaviour** child/sibling/complex; checkboxes; expand/collapse all; indentation.

## Form `@jects/widgets` Form
20+ control types `[have]`; validation engine (required/email/numeric/min-max/pattern/custom/async) `[have]`;
nested layout/fieldsets `[have]`; data binding `[have]`; **conditional fields / show-hide rules**; **field groups**.

## RichText `@jects/widgets`
`[have, fixed]` bold/italic/underline/strike, headings, lists, link, blockquote, code (toggle), undo/redo, align.
**Verify/add:** images, tables, text/bg color, font family/size, indent, source view, markdown export, paste-clean.

## Charts/widgets/etc. (lighter)
Most Suite-class widgets (buttons, fields, layout, nav, overlays, tree, list, dataview, todo, booking, chatbot)
are at DHTMLX-Suite parity from the core build — audit each against its DHTMLX counterpart and close any gaps.

---

## Depth-pass priority (highest customer value first)
1. **Gantt** · 2. **Grid** · 3. **Scheduler** · 4. **Spreadsheet** · 5. **Diagram** · 6. **Pivot** ·
7. **Charts** · 8. **Calendar** · 9. **Kanban** · 10. Tree/TreeGrid · 11. Form/RichText · 12. Suite-widget audit.

Adapters (React/Angular/Vue — Wave 6) run LAST, wrapping the parity-complete components.
