/** Route: how it compares — static positioning page (no @jects component modules). */
import { el, card } from '../shell/dom.js';
import { section } from '../shell/registry.js';

export function register() {
  section(
    'compare',
    'How it compares',
    'A controlled, honest comparison of Jects UI against the established category leaders — positioned on architecture and breadth-on-one-core, not on "a feature they lack."',
    (grid) => {
      // a. Methodology / honesty callout box.
      grid.appendChild(card('Methodology & honesty', (h) => {
        const box = el('div', {
          style: 'width:100%;border:1px solid oklch(var(--jects-border));border-left:4px solid oklch(var(--jects-primary));border-radius:var(--jects-radius-md,8px);background:oklch(var(--jects-muted));padding:.9rem 1.1rem;line-height:1.6',
        });
        box.appendChild(el('p', { style: 'margin:.2rem 0', html:
          '<strong>Controlled comparison.</strong> Competitor capabilities reflect each vendor’s publicly documented feature set as of 2026-06 — verify current vendor docs before relying on any cell.' }));
        box.appendChild(el('p', { style: 'margin:.5rem 0',
          text: 'The incumbents (AG Grid, Bryntum, DHTMLX, Handsontable, FullCalendar, Highcharts, GoJS, yFiles) are excellent and in places deeper on a single component. Jects differentiates on architecture and breadth-on-one-core, not "a feature they lack."' }));
        box.appendChild(el('p', { style: 'margin:.5rem 0 .2rem', html:
          'The Jects column is verifiable from this repo (see the Matrix + the live demos — try <a href="#performance">#performance</a>).' }));
        h.appendChild(box);
      }, { block: true }));

      // b. The architecture table (the headline).
      grid.appendChild(card('The architecture comparison (the part that actually differs)', (h) => {
        h.appendChild(el('p', { class: 'g-note', style: 'margin-top:0',
          text: 'Individual components converge on similar feature lists; the durable differences are structural.' }));
        const rows = [
          ['One engine across all modules',
            'One zero-dependency @jects/core (Widget, Store/TreeStore, signals, virtualization, factory) under every module',
            'Often multiple internal engines; shared theming varies',
            'N/A — one component only'],
          ['Framework posture',
            'Framework-agnostic light-DOM classes; thin React/Vue/Angular/Web-Component wrappers over the same imperative API',
            'Mixed (some framework-first with ports)',
            'Frequently framework-specific'],
          ['Theming',
            'One 3-tier OKLCH token system as CSS variables; one customizer themes the whole suite; exportThemeCss()',
            'Per-product theme systems; cross-product unity varies',
            'Component-scoped theming'],
          ['Runtime dependencies',
            'Zero runtime deps in core',
            'Varies; some large dep trees',
            'Varies'],
          ['Packaging',
            'Stable imperative API + per-component subpath exports',
            'Varies; some monolithic',
            'Single package'],
          ['Licensing posture',
            'One suite, one source tree',
            'Often per-developer/per-domain per product',
            'Per-component commercial common'],
        ];
        const cellBase = 'border:1px solid oklch(var(--jects-border));padding:.5rem .7rem;text-align:left;vertical-align:top';
        const headStyle = cellBase + ';background:oklch(var(--jects-muted));font-weight:600';
        const thead = el('thead', {}, [
          el('tr', {}, [
            el('th', { style: headStyle, text: 'Dimension' }),
            el('th', { style: headStyle, text: 'Jects UI' }),
            el('th', { style: headStyle, text: 'Typical incumbent suite' }),
            el('th', { style: headStyle, text: 'Typical single-component vendor' }),
          ]),
        ]);
        const tbody = el('tbody', {}, rows.map((r) => el('tr', {}, [
          el('th', { scope: 'row', style: cellBase + ';font-weight:600', text: r[0] }),
          el('td', { style: cellBase, text: r[1] }),
          el('td', { style: cellBase + ';color:oklch(var(--jects-muted-foreground))', text: r[2] }),
          el('td', { style: cellBase + ';color:oklch(var(--jects-muted-foreground))', text: r[3] }),
        ])));
        const tableWrap = el('div', { style: 'width:100%;overflow:auto' });
        tableWrap.appendChild(el('table', { class: 'g-perf-table', style: 'width:100%;border-collapse:collapse;font-size:.85rem;line-height:1.5' }, [thead, tbody]));
        h.appendChild(tableWrap);
        h.appendChild(el('p', { class: 'g-note',
          text: 'Takeaway: choose the single-core suite when you need several of these surfaces unified on one mental model and one dependency story; a specialist incumbent may still win when you need the single deepest component on one axis — a fair call.' }));
      }, { block: true }));

      // c. Per-category cards.
      const CATEGORIES = [
        { name: 'Data grid', against: 'AG Grid, Bryntum Grid, DHTMLX Grid, Handsontable',
          items: ['Virtualized rows + columns', 'Typed columns, sort, multi-filter', 'Grouping / aggregation',
            'Inline editing', 'Master-detail + tree', 'Cell / row / range selection',
            'CSV / Excel / PDF export', 'Server-side data source'],
          note: 'AG Grid is exceptionally deep on grid-only depth; Jects’s edge is the shared core + suite theming.' },
        { name: 'Gantt', against: 'Bryntum Gantt, DHTMLX Gantt, Syncfusion Gantt',
          items: ['Task tree + dependencies', 'Baselines + critical path', 'Resource histogram', 'Undo/redo',
            'Scheduling engine', 'PDF/PNG/CSV/XLSX/ICS export', 'MS-Project (MSPDI) import/export'],
          note: 'Bryntum Gantt is the depth leader; Jects covers the enterprise spine on the shared core.' },
        { name: 'Resource scheduling', against: 'Bryntum Scheduler, DHTMLX Scheduler',
          items: ['Multi-resource time grid', 'Time ranges + recurrence', 'Travel-time / buffers (Pro)',
            'Pan / infinite scroll', 'Export'] },
        { name: 'Calendar', against: 'FullCalendar',
          items: ['Day/week/month/year/agenda/resource/timeline views', 'RRULE recurrence + timezones',
            'Modal editor + undo/redo', 'ICS / Excel / print export'] },
        { name: 'Spreadsheet', against: 'Handsontable, Univer, SheetJS (IO)',
          items: ['Formula engine', 'Validation + dropdowns', 'Conditional formatting',
            'Named ranges / comments / protection', 'Embedded charts + fill-handle',
            'Multi-sheet', 'XLSX import/export'] },
        { name: 'Pivot', against: 'Flexmonster, WebDataRocks',
          items: ['Dimensions / measures / aggregations', 'Conditional formatting',
            'Collapsible headers', 'OOXML XLSX export'] },
        { name: 'Boards & tasks', against: 'Bryntum TaskBoard (kanban) and Asana/ClickUp/Monday/Jira-class tools (task manager)',
          items: ['Columns + swimlanes + WIP limits (kanban)', 'Rich cards + DnD + undo/redo (kanban)',
            'List/Board/Calendar/Timeline/Table views (todo)', 'Workflow statuses, dependencies, subtasks (todo)',
            'Comments, time tracking, recurrence (todo)', 'Import/export (todo)'] },
        { name: 'Charts', against: 'Highcharts, ECharts, Chart.js',
          items: ['Line/bar/area/pie/scatter/bubble (+more)', 'Numeric/time/category axes',
            'Zoom/pan + crosshair + annotations', 'Data labels + streaming', 'Export'],
          note: 'Highcharts/ECharts have a wider exotic-chart catalog; Jects covers the mainstream business set integrated with the suite.' },
        { name: 'Diagramming', against: 'GoJS, yFiles, draw.io/mxGraph, JointJS',
          items: ['Built-in/custom/HTML/image shapes', 'A*-routed connectors',
            'Auto-layout (orthogonal/radial)', 'Swimlanes + groups', 'Undo/redo', 'JSON/PNG/PDF export'],
          note: 'yFiles leads on large-graph layout; Jects targets common flowchart/org/mind/PERT needs.' },
      ];
      const catWrap = el('div', { class: 'g-grid', style: 'width:100%;margin-top:.25rem' });
      for (const cat of CATEGORIES) {
        const checklist = el('ul', { style: 'list-style:none;margin:.5rem 0 0;padding:0;display:flex;flex-direction:column;gap:.3rem' },
          cat.items.map((it) => el('li', { style: 'display:flex;gap:.5rem;align-items:flex-start;font-size:.85rem;line-height:1.4' }, [
            el('span', { 'aria-hidden': 'true', style: 'color:oklch(var(--jects-success));font-weight:700', text: '✅' }),
            el('span', { text: it }),
          ])));
        const body = [
          el('div', { class: 'g-note', style: 'margin-top:0;text-transform:none;font-size:.78rem',
            html: '<strong>Benchmarked against:</strong> ' + cat.against }),
          checklist,
        ];
        if (cat.note) body.push(el('p', { class: 'g-note', style: 'font-style:italic', text: cat.note }));
        catWrap.appendChild(el('div', { class: 'g-card', style: 'padding:0' }, [
          el('div', { class: 'g-card__hd', text: cat.name }),
          el('div', { class: 'g-card__bd is-block' }, body),
        ]));
      }
      grid.appendChild(card('Per-category map', (h) => {
        h.appendChild(el('p', { class: 'g-note', style: 'margin-top:0',
          text: 'Each card shows who we benchmark the category against and the Jects capabilities shipped in this repo (all verifiable via the live demos). We do not score competitor cells here — consult vendor docs for theirs.' }));
        h.appendChild(catWrap);
      }, { block: true }));

      // d. Closing "When to choose what" block.
      grid.appendChild(card('When to choose what', (h) => {
        h.appendChild(el('p', { style: 'margin:.2rem 0;line-height:1.6',
          html: '<strong>Choose Jects UI</strong> when you need several of these surfaces unified on one core, one theming/token system, and one imperative API — with a single zero-dependency core and one source tree, so the whole planning-and-data surface looks and behaves as one system.' }));
        h.appendChild(el('p', { style: 'margin:.6rem 0;line-height:1.6',
          html: '<strong>Choose a specialist incumbent</strong> when you need the single deepest component on one axis (the deepest grid, the deepest large-graph layout, the widest exotic-chart catalog) and don’t need cross-suite unification — those products have years of focused depth, and that is a legitimate reason to pick them.' }));
        h.appendChild(el('p', { class: 'g-note', style: 'font-size:.85rem',
          html: '<strong>Verify before you commit:</strong> run <a href="#performance">#performance</a> on your hardware, read the Matrix, check each incumbent’s current docs.' }));
      }, { block: true }));
    },
    { wide: true },
  );
}
