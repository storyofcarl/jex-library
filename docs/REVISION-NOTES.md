# Revision Notes — next round (post theme-customizer)

> Captured during the enriched-theme-customizer build. **Do not act on these until the
> customizer update is done** — then turn them into a plan (audit current state per item,
> scope, then orchestrate as workflows/agents, raw-verified + deployed).

## Tables (grid / pivot / spreadsheet / todo table view / scheduler+gantt locked columns)
- **Resizable rows** — row-height drag resize (in addition to column resize).
- **Resizable columns** — confirm/extend column resize across all table-bearing components.
- **Multi-select** — row multi-select (checkbox + ctrl/shift range) everywhere a table renders.
  - Audit first: grid already has selection + column resize; verify which table components are missing row-resize / multi-select and add uniformly.

## Export UX
- **Consolidate multiple export formats into a single Export menu item.** Where a component offers several export formats (e.g. gantt: CSV/XLSX/PDF/PNG/ICS/MS-Project), present them under one "Export ▾" menu rather than separate buttons. Apply across grid/scheduler/spreadsheet/pivot/calendar/charts/gantt.

## Layout / sizing (IMPORTANT principle)
- **Don't fix-height + `overflow:hidden` modules that need to grow dynamically.** Carl: kanban is cut off when many cards land in one swimlane. Modules should size to content (or scroll appropriately) instead of being clipped by a fixed host height. Audit every module's host/root sizing:
  - The gallery hosts use `height: var(--g-page-host)`; combined with module roots that set fixed height + `overflow:hidden`, tall content (kanban swimlanes, big boards, large forms) gets clipped.
  - NOTE: my earlier todo fix added `.jects-todo { block-size:100%; overflow:hidden }` (to stop overflow-into-note) — revisit so it scrolls internally OR grows, but never clips content. Apply a consistent strategy across modules: internal scroll for data grids/virtualized views; grow-to-content for boards/forms.

## Bugs
- **Booking: an unexplained extra "table" on the right.** Carl: "not sure what the additional table on the right on the booking module is." Investigate the booking demo/layout — likely the month/week calendar overview (`showCalendarView`) or a stray panel rendering as a table-like grid on the right; clarify/label it or remove if unintended.
- **Gantt: a menu/popover is open when it shouldn't be.** Screenshot shows the baseline panel ("Base… ↓ Export, As-planned / Re-plan checkboxes, Capture baseline" button) floating/open on load. The baseline (and/or export) popover is rendering visible by default or mis-anchored — should be closed until its trigger is clicked. Investigate the gantt baseline-compare picker + export menu open-state/anchoring (note: a prior session fixed a gantt overlay anchoring issue via `.jects-gantt { position: relative }` — this may be a related default-open/z-order regression).

## Bugs (more)
- **Chatbot: chat input field cuts off text at the bottom.** The message composer/input clips its bottom — likely a fixed height/line-height/padding or overflow issue on the chatbot input area. Fix so the field shows full text (auto-grow or correct height/padding).

## Scheduler (Carl: "feels light") — VERDICT: code is enterprise-grade, demo is light
Evidence (from scheduler/dist/index.d.ts + SchedulerConfig): resources/events/**assignments** (multi-assignment), **dependencies + constraints** (DependencyModel/DependencyType/ConstraintType), **working-time calendar** (WorkingTimeCalendar/showNonWorkingTime), recurrence, time-ranges + resource-time-ranges, orientation (h/v), view presets + zoom, event-overlap/lane layout, pan + infinite-scroll, drag/resize/create/edit + editable deps, now-marker, undo/redo STM. 54 exports · 346 unit · 46 browser · 13 a11y. So NOT a code gap.
- (b, decided) **Scheduler demo-enrichment**: surface dependencies, working-time/non-working shading, multi-assignment, the event editor, undo/redo, orientation + zoom toggles (the gallery card shows a fraction).
- (b, decided) **Scheduler-Pro parity gap-audit**: NO explicit resource-grouping/tree-resources or event-buffer/travel-time symbols seen in the export surface — verify against Bryntum Scheduler Pro and close any real tail gaps.

## Demos under-showing features
- **Sweep ALL module demos vs their API — surface every feature.** Carl: "kanban looks lighter than before" (possible regression from the enterprise-demo pass + check it shows rich cards/cover/comments/votes/links/WIP/swimlanes/DnD/sort/filter/export). Do a per-module demo-vs-API diff and enrich any that under-show.
- **Spreadsheet demo** doesn't surface all features (e.g. multiple **sheets**/sheet tabs, etc.). Audit the spreadsheet's real API surface (sheets, formulas, validation, conditional formatting, named ranges, comments, embedded charts, fill-handle, protection, XLSX) and make the demo card exercise the full set. Likely applies to other modules too — sweep each demo vs its API and surface anything hidden.

## Rich text
- **RichText WYSIWYG is not enterprise-grade.** Carl. Audit `@jects/widgets` RichText vs category leaders (TinyMCE/CKEditor/Froald/Quill): toolbar depth, tables (insert/edit rows-cols), images (upload/resize/align), links, lists/indent, fonts/size/color/highlight, blockquote/code, find-replace, paste-clean, markdown, source view, undo/redo, word count, full-screen, accessibility. Identify gaps and enrich to a real WYSIWYG.
