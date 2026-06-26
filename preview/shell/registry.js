/**
 * Registration substrate — the shared state + machinery that every route module
 * calls into. Extracted verbatim from the original gallery.js.
 *
 * The lazy @jects/* bindings below are exported `let`s populated on demand by the
 * loader functions. Because ES module imports are LIVE bindings, a route module
 * that does `import { Button } from '../shell/registry.js'` sees the binding get
 * filled in the moment its loader resolves — exactly as the old module-scoped
 * `let`s worked, just across module boundaries. The demo build functions keep
 * referring to `Button`, `Grid`, `Gantt`, … unchanged.
 */

import { el } from './dom.js';

/* ───────────────────── lazy module bindings ───────────────────── */

// widgets
export let Button, TextField, NumberField, TextArea, DisplayField, Label, Link,
  Select, ComboBox, Checkbox, CheckboxGroup, Radio, RadioGroup, Switch,
  Slider, RangeSlider, Rating, ProgressBar, Badge, Avatar, Spacer,
  DatePicker, TimePicker, DateTimeField, MiniCalendar, ColorPicker, FilePicker,
  Tooltip, Popup, Mask, MessageManager, alert, confirm, prompt, Form,
  Layout, Splitter, Panel, Container, Toolbar, Menu, ContextMenu, Sidebar, Ribbon,
  Tabbar, TabPanel, Pagination, Window, Dialog, RichText, Tree, List, DataView;
// grid + core
export let Grid, summaryFeature, editingFeature, columnStateFeature, columnPickerFeature,
  filterBarFeature, filterMenuFeature, filterFacetFeature, undoRedoFeature,
  rowExpanderFeature, tooltipFeature, exportFeature, pdfExportFeature, fillFeature,
  headerGroupsFeature, TreeStore;
// charts / pivot / spreadsheet
export let Chart, PivotTable, AggregatorRegistry, Spreadsheet;
// scheduling
export let Scheduler, SchedulerStm, Gantt, GanttProgressLineFeature, GanttIndicatorsFeature,
  MultiBaselineCompare, ProjectLines, GanttExportMenu, GanttUndoRedo,
  GanttRollupFeature, GanttSegmentedTasksFeature, ResourceHistogram,
  ResourceUtilizationView, PertView, DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
  rollupColumn, ganttToMsProjectXml, Calendar, TaskBoard, HOUR_AND_DAY, WEEK_AND_DAY;
// wave 5
export let Diagram, documentToJson, downloadBlob, TodoList, Booking, Chatbot;

/* Memoize each dynamic import() promise by specifier so a module is fetched +
   evaluated AT MOST ONCE no matter how many sections need it or how often a
   route is re-visited. Instrumentable for the lazy-load test harness. */
const _moduleCache = new Map();
export function importOnce(spec) {
  let p = _moduleCache.get(spec);
  if (!p) {
    if (typeof window !== 'undefined' && Array.isArray(window.__JECTS_LOADED__)) {
      window.__JECTS_LOADED__.push(spec);
    }
    p = import(/* @vite-ignore */ spec);
    _moduleCache.set(spec, p);
  }
  return p;
}

/* ───────────────────────── per-route CSS lazy-load ───────────────────────── */
const _cssInjected = new Set();
export function ensureCss(pkg) {
  if (_cssInjected.has(pkg)) return;
  _cssInjected.add(pkg);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '../packages/' + pkg + '/dist/style.css';
  document.head.appendChild(link);
  if (typeof window !== 'undefined') {
    (window.__JECTS_CSS__ || (window.__JECTS_CSS__ = [])).push(pkg);
  }
}

// Per-package loaders. Each memoizes its own binding-assignment promise so the
// destructuring runs once; subsequent calls return the cached promise. Each
// loader also injects its package's CSS (and any shared-dep CSS) via ensureCss
// so the stylesheet is present before the demo builds.
let _pWidgets, _pGrid, _pCore, _pCharts, _pPivot, _pSpreadsheet, _pScheduler,
  _pGantt, _pCalendar, _pKanban, _pTimeline, _pDiagram, _pTodo, _pBooking, _pChatbot;

export function loadWidgets() {
  ensureCss('widgets');
  return (_pWidgets ||= importOnce('@jects/widgets').then((m) => {
    ({ Button, TextField, NumberField, TextArea, DisplayField, Label, Link,
       Select, ComboBox, Checkbox, CheckboxGroup, Radio, RadioGroup, Switch,
       Slider, RangeSlider, Rating, ProgressBar, Badge, Avatar, Spacer,
       DatePicker, TimePicker, DateTimeField, MiniCalendar, ColorPicker, FilePicker,
       Tooltip, Popup, Mask, MessageManager, alert, confirm, prompt, Form,
       Layout, Splitter, Panel, Container, Toolbar, Menu, ContextMenu, Sidebar, Ribbon,
       Tabbar, TabPanel, Pagination, Window, Dialog, RichText, Tree, List, DataView } = m);
  }));
}
export function loadGrid() {
  ensureCss('grid');
  return (_pGrid ||= importOnce('@jects/grid').then((m) => {
    ({ Grid, summaryFeature, editingFeature, columnStateFeature, columnPickerFeature,
       filterBarFeature, filterMenuFeature, filterFacetFeature, undoRedoFeature,
       rowExpanderFeature, tooltipFeature, exportFeature, pdfExportFeature, fillFeature,
       headerGroupsFeature } = m);
  }));
}
export function loadCore() {
  return (_pCore ||= importOnce('@jects/core').then((m) => { ({ TreeStore } = m); }));
}
export function loadCharts() {
  ensureCss('charts');
  return (_pCharts ||= importOnce('@jects/charts').then((m) => { ({ Chart } = m); }));
}
export function loadPivot() {
  ensureCss('pivot');
  return (_pPivot ||= importOnce('@jects/pivot').then((m) => { ({ PivotTable, AggregatorRegistry } = m); }));
}
export function loadSpreadsheet() {
  ensureCss('spreadsheet');
  return (_pSpreadsheet ||= importOnce('@jects/spreadsheet').then((m) => { ({ Spreadsheet } = m); }));
}
export function loadTimeline() {
  ensureCss('timeline-core');
  return (_pTimeline ||= importOnce('@jects/timeline-core').then((m) => { ({ HOUR_AND_DAY, WEEK_AND_DAY } = m); }));
}
export function loadScheduler() {
  ensureCss('scheduler');
  return (_pScheduler ||= importOnce('@jects/scheduler').then((m) => { ({ Scheduler, SchedulerStm } = m); }));
}
export function loadGantt() {
  ensureCss('gantt');
  return (_pGantt ||= importOnce('@jects/gantt').then((m) => {
    ({ Gantt, GanttProgressLineFeature, GanttIndicatorsFeature, MultiBaselineCompare,
       ProjectLines, GanttExportMenu, GanttUndoRedo, GanttRollupFeature,
       GanttSegmentedTasksFeature, ResourceHistogram, ResourceUtilizationView, PertView,
       DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS, rollupColumn, ganttToMsProjectXml } = m);
  }));
}
export function loadCalendar() {
  ensureCss('calendar');
  return (_pCalendar ||= importOnce('@jects/calendar').then((m) => { ({ Calendar } = m); }));
}
export function loadKanban() {
  ensureCss('kanban');
  return (_pKanban ||= importOnce('@jects/kanban').then((m) => { ({ TaskBoard } = m); }));
}
export function loadDiagram() {
  ensureCss('diagram');
  return (_pDiagram ||= importOnce('@jects/diagram').then((m) => { ({ Diagram, documentToJson, downloadBlob } = m); }));
}
export function loadTodo() {
  ensureCss('todo');
  return (_pTodo ||= importOnce('@jects/todo').then((m) => { ({ TodoList } = m); }));
}
export function loadBooking() {
  ensureCss('booking');
  return (_pBooking ||= importOnce('@jects/booking').then((m) => { ({ Booking } = m); }));
}
export function loadChatbot() {
  ensureCss('chatbot');
  return (_pChatbot ||= importOnce('@jects/chatbot').then((m) => { ({ Chatbot } = m); }));
}

/* Route id → the lazy module loader(s) that route's demo needs. */
export const SECTION_LOADERS = {
  customizer: () => Promise.all([loadWidgets(), loadGrid(), loadCore(), loadCharts()]),
  buttons: () => loadWidgets(),
  inputs: () => loadWidgets(),
  forms: () => loadWidgets(),
  layout: () => loadWidgets(),
  navigation: () => loadWidgets(),
  overlays: () => loadWidgets(),
  richtext: () => loadWidgets(),
  grid: () => Promise.all([loadWidgets(), loadGrid(), loadCore()]),
  charts: () => Promise.all([loadWidgets(), loadCharts()]),
  pivot: () => Promise.all([loadWidgets(), loadPivot()]),
  spreadsheet: () => Promise.all([loadWidgets(), loadSpreadsheet()]),
  scheduler: () => Promise.all([loadWidgets(), loadScheduler(), loadTimeline()]),
  gantt: () => Promise.all([loadWidgets(), loadGantt(), loadTimeline()]),
  calendar: () => loadCalendar(),
  kanban: () => Promise.all([loadWidgets(), loadKanban()]),
  diagram: () => Promise.all([loadWidgets(), loadDiagram()]),
  todo: () => loadTodo(),
  booking: () => loadBooking(),
  chatbot: () => loadChatbot(),
  // Integrated workflows — each lazy-loads exactly the modules it links together.
  'flow-analytics': () => Promise.all([loadWidgets(), loadPivot(), loadCharts()]),
  'flow-planning': () => Promise.all([loadWidgets(), loadKanban(), loadGantt(), loadTimeline()]),
  'flow-data': () => Promise.all([loadWidgets(), loadGrid(), loadCharts()]),
  // Live — a real-time collaboration board driven by a simulated remote provider.
  realtime: () => Promise.all([loadWidgets(), loadKanban()]),
  // Proof pages.
  performance: () => Promise.all([
    loadWidgets(), loadGrid(), loadCore(), loadPivot(),
    loadScheduler(), loadGantt(), loadTimeline(),
  ]),
  'server-data': () => Promise.all([loadWidgets(), loadGrid(), loadCore()]),
  // Static positioning page — no @jects component modules, no component CSS.
  compare: () => Promise.resolve(),
};

/* ───────────────────────── section registry ───────────────────────── */

export const SECTIONS = [];
export const SECTION_NODES = new Map(); // id -> <section> element (for lazy activation)

/**
 * Register a routed section. The demo `build(grid)` is DEFERRED — it does not
 * run at module load. Instead it runs the first time the route is activated
 * (see `activateSection`), after the route's loader (from `SECTION_LOADERS`)
 * has dynamically import()ed the `@jects/*` module(s) the demo needs.
 */
export function section(id, title, lede, build, { wide = false } = {}) {
  SECTIONS.push({ id, title });
  const grid = el('div', { class: 'g-grid' + (wide ? ' is-wide' : '') });
  const sec = el('section', { class: 'g-section', id }, [
    el('h2', { text: title }),
    lede ? el('p', { class: 'g-lede', text: lede }) : null,
    grid,
  ]);
  sec._jects = { build, grid, built: false, building: null };
  SECTION_NODES.set(id, sec);
  return sec;
}

/**
 * Lazily activate a section: show a loading state, dynamically import its
 * module(s), then run the (one-time) demo build. Memoized per section so a
 * re-visit never re-imports or re-renders.
 */
export function activateSection(sec) {
  const s = sec && sec._jects;
  if (!s || s.built || s.building) return s ? s.building : null;

  const loading = el('div', { class: 'g-loading' }, [
    el('div', { class: 'g-spinner', 'aria-hidden': 'true' }),
    el('div', { text: 'Loading module…' }),
  ]);
  loading.setAttribute('role', 'status');
  s.grid.appendChild(loading);

  const load = SECTION_LOADERS[sec.id];
  s.building = (async () => {
    try {
      if (load) await load();
      loading.remove();
      s.build(s.grid);
      s.built = true;
    } catch (err) {
      loading.remove();
      s.grid.replaceChildren(
        el('div', { class: 'g-note', style: 'color:oklch(var(--jects-destructive))' },
          'Failed to load this module: ' + (err && err.message ? err.message : String(err))),
      );
      console.error('[gallery] section "' + sec.id + '" failed to load:', err);
    } finally {
      s.building = null;
    }
  })();
  return s.building;
}

/* ── route metadata: title · search blurb · which markdown doc it shows ──── */
export const ROUTE_META = {
  // Start
  home: { title: 'Home', doc: 'core', desc: 'Overview — what Jects UI is, why it is credible, and where to start: one zero-dependency core, one OKLCH design language, the whole planning-and-data surface.' },
  // Foundation
  foundations: { title: 'Foundations', doc: 'tokens', desc: 'Design tokens — semantic colors, the Calm CMYK palette, the chart data ramp, radius and type.' },
  core: { title: 'Core', doc: 'core', desc: 'Widget base class, reactive store, TreeStore, event bus, DOM helpers and the HTML sanitizer.', docsOnly: true },
  theme: { title: 'Theme', doc: 'theme', desc: 'Theme runtime — light / dark / high-contrast, setTheme and applyTheme token overrides.', docsOnly: true },
  icons: { title: 'Icons', doc: 'icons', desc: 'The SVG icon sprite and icon helper used across every component.', docsOnly: true },
  customizer: { title: 'Theme customizer', doc: 'theme', desc: 'Live, exportable token editor — edit primary, accent, foreground, background, radius, font and spacing and watch real components across the suite restyle, then download or copy a ready-to-ship theme.css.' },
  'timeline-core': { title: 'Timeline Core', doc: 'timeline-core', desc: 'Shared time axis, viewport, row virtualization and drag interactions for the scheduling modules.', docsOnly: true },
  // Data
  grid: { title: 'Grid', doc: 'grid', desc: 'Enterprise data grid — sorting, filtering, grouping, editing, tree data, summaries and export.' },
  pivot: { title: 'Pivot', doc: 'pivot', desc: 'Pivot table — cross-tab aggregation across rows, columns and measures.' },
  spreadsheet: { title: 'Spreadsheet', doc: 'spreadsheet', desc: 'Formula spreadsheet — cells, number formats, SUM and a function library.' },
  // Scheduling
  gantt: { title: 'Gantt', doc: 'gantt', desc: 'Project Gantt — WBS, dependencies, baselines, rollups, resource views and MS-Project export.' },
  scheduler: { title: 'Scheduler', doc: 'scheduler', desc: 'Resource scheduler — a timeline of bookings and shifts across resources.' },
  calendar: { title: 'Calendar', doc: 'calendar', desc: 'Calendar — month / week / day event views.' },
  booking: { title: 'Booking', doc: 'booking', desc: 'Appointment booking — services, availability rules, timezones, capacity, waitlist and ICS export.' },
  // Boards & Tasks
  kanban: { title: 'Kanban', doc: 'kanban', desc: 'Kanban task board — columns, swimlanes, WIP limits and drag & drop.' },
  todo: { title: 'To-Do', doc: 'todo', desc: 'Enterprise task manager — five views, dependencies, time tracking, undo/redo and import/export.' },
  charts: { title: 'Charts', doc: 'charts', desc: 'Charts — line, bar, area, pie and more, themed on the data ramp.' },
  diagram: { title: 'Diagram', doc: 'diagram', desc: 'No-code diagram editor — flowchart, org, mindmap and PERT with auto-layout.' },
  // Widgets & Chat
  widgets: { title: 'Widgets overview', doc: 'widgets', desc: 'The widget toolkit — buttons, inputs, forms, layout, navigation, overlays and rich text.', docsOnly: true },
  buttons: { title: 'Buttons', doc: 'widgets', desc: 'Button variants, sizes, icons, loading and disabled states.' },
  inputs: { title: 'Inputs', doc: 'widgets', desc: 'Text, number, area, choice, sliders, ratings, color and date pickers.' },
  forms: { title: 'Forms', doc: 'widgets', desc: 'Schema-driven forms with validation rules, fieldsets and grid layout.' },
  layout: { title: 'Layout', doc: 'widgets', desc: 'Border layout, splitters, panels and flex / grid containers.' },
  navigation: { title: 'Navigation', doc: 'widgets', desc: 'Toolbar, menu, context menu, sidebar, ribbon, tabs and pagination.' },
  overlays: { title: 'Overlays & Feedback', doc: 'widgets', desc: 'Tooltips, popups, masks, floating windows, dialogs and toasts.' },
  richtext: { title: 'Rich text', doc: 'widgets', desc: 'Rich-text editor plus tree, list and data-view widgets.' },
  chatbot: { title: 'Chatbot', doc: 'chatbot', desc: 'LLM-agnostic chat UI with streaming markdown replies.' },
  // Integrated workflows — cross-module demos sharing one data model.
  'flow-analytics': { title: 'Pivot → Chart', doc: 'pivot', desc: 'Cross-module dashboard: a Pivot cross-tab and a Chart over one dataset — the chart renders from the pivot’s live aggregates.' },
  'flow-planning': { title: 'Kanban ↔ Gantt', doc: 'gantt', desc: 'One shared task model, two live-linked views: moving a Kanban card updates the task and repaints the Gantt.' },
  'flow-data': { title: 'Grid → Chart', doc: 'grid', desc: 'Selecting rows in the Grid drives a Chart that plots exactly the selected rows.' },
  // Live — real-time / multi-user collaboration.
  realtime: { title: 'Live collaboration', doc: 'kanban', desc: 'Real-time board driven by a simulated multi-user data provider — cards move, arrive and change live via the board’s dataProvider.subscribe() surface, with a Live indicator, Start/Pause and an activity feed.' },
  // Proof — measured performance + server-side data integration.
  performance: { title: 'Performance', doc: 'grid', desc: 'Live, measured benchmarks of the heavy modules (Grid 100k rows, Pivot 50k records, Scheduler, Gantt) — build+render time and sampled frame rate, measured in your browser on this device, not synthetic claims.' },
  'server-data': { title: 'Server-side data', doc: 'grid', desc: 'A Grid bound to a simulated async backend — server-side sort, filter and pagination over a 100,000-row store, fetching one page at a time with a live request log proving only one page is in the DOM.' },
  compare: { title: 'How it compares', doc: 'core', desc: 'A controlled, honest comparison against the category leaders — positioned on one-core architecture, suite-wide OKLCH theming and breadth, with per-category benchmarks and "when to choose what" guidance.' },
};

/* ── sidebar grouping (the product taxonomy) ──────────────────────────── */
export const SIDEBAR_GROUPS = [
  { label: 'Start', items: ['home'] },
  { label: 'Foundation', items: ['foundations', 'core', 'theme', 'icons', 'timeline-core'] },
  { label: 'Theme', items: ['customizer'] },
  { label: 'Data', items: ['grid', 'pivot', 'spreadsheet'] },
  { label: 'Scheduling', items: ['gantt', 'scheduler', 'calendar', 'booking'] },
  { label: 'Boards & Tasks', items: ['kanban', 'todo', 'charts', 'diagram'] },
  { label: 'Widgets & Chat', items: ['widgets', 'buttons', 'inputs', 'forms', 'layout', 'navigation', 'overlays', 'richtext', 'chatbot'] },
  { label: 'Integrated workflows', items: ['flow-analytics', 'flow-planning', 'flow-data'] },
  { label: 'Live', items: ['realtime'] },
  { label: 'Proof', items: ['performance', 'server-data', 'compare'] },
];
