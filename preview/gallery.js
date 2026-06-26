/**
 * Jects UI — interactive component gallery.
 *
 * Runs entirely against the already-built `dist/` ESM bundles (resolved via the
 * import map in index.html). No build step, no install. Every card instantiates
 * a live, interactive component: `new Cmp(hostEl, config)`.
 */

/* The shell (theme switcher, primary/radius controls, default theme) needs the
   theme module synchronously, so it stays EAGER. Everything else — widgets,
   grid, charts, gantt, scheduler, … — is LAZY-LOADED per route via dynamic
   import() below, so visiting a route downloads only that module (+ its shared
   deps), not the whole 14-package suite. The import map in index.html still
   resolves the bare @jects/* specifiers for both static and dynamic imports. */
import { setTheme, applyTheme, exportThemeCss, clearTheme } from '@jects/theme';

/* ───────────────────── lazy module bindings + loaders ─────────────────────
   These were previously static named imports. They're now module-scoped `let`s
   populated on demand by the loader functions, so the (unchanged) demo build
   functions can keep referring to `Button`, `Grid`, `Gantt`, … exactly as
   before — the binding is just filled in right before the section builds. */

// widgets
let Button, TextField, NumberField, TextArea, DisplayField, Label, Link,
  Select, ComboBox, Checkbox, CheckboxGroup, Radio, RadioGroup, Switch,
  Slider, RangeSlider, Rating, ProgressBar, Badge, Avatar, Spacer,
  DatePicker, TimePicker, DateTimeField, MiniCalendar, ColorPicker, FilePicker,
  Tooltip, Popup, Mask, MessageManager, alert, confirm, prompt, Form,
  Layout, Splitter, Panel, Container, Toolbar, Menu, ContextMenu, Sidebar, Ribbon,
  Tabbar, TabPanel, Pagination, Window, Dialog, RichText, Tree, List, DataView;
// grid + core
let Grid, summaryFeature, editingFeature, columnStateFeature, columnPickerFeature,
  filterBarFeature, filterMenuFeature, filterFacetFeature, undoRedoFeature,
  rowExpanderFeature, tooltipFeature, exportFeature, pdfExportFeature, fillFeature,
  headerGroupsFeature, TreeStore;
// charts / pivot / spreadsheet
let Chart, PivotTable, AggregatorRegistry, Spreadsheet;
// scheduling
let Scheduler, SchedulerStm, Gantt, GanttProgressLineFeature, GanttIndicatorsFeature,
  MultiBaselineCompare, ProjectLines, GanttExportMenu, GanttUndoRedo,
  GanttRollupFeature, GanttSegmentedTasksFeature, ResourceHistogram,
  ResourceUtilizationView, PertView, DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
  rollupColumn, ganttToMsProjectXml, Calendar, TaskBoard, HOUR_AND_DAY, WEEK_AND_DAY;
// wave 5
let Diagram, documentToJson, downloadBlob, TodoList, Booking, Chatbot;

/* Memoize each dynamic import() promise by specifier so a module is fetched +
   evaluated AT MOST ONCE no matter how many sections need it or how often a
   route is re-visited. Instrumentable for the lazy-load test harness. */
const _moduleCache = new Map();
function importOnce(spec) {
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

/* ───────────────────────── per-route CSS lazy-load ─────────────────────────
   The component stylesheets used to be eagerly <link>ed in index.html's <head>
   (~13 of them). They're now injected ON DEMAND: each package loader calls
   `ensureCss(pkg)` BEFORE its module resolves, so a route's CSS lands in <head>
   right before that route's demo builds (no flash of unstyled content), and a
   first page load no longer downloads stylesheets for routes never visited.
   Only the theme tokens (theme/dist/css/all.css) + gallery.css stay eager in
   the HTML so the shell chrome is always styled. Memoized per pkg — the <link>
   is appended at most once no matter how many loaders ask for it. Instrumented
   on window.__JECTS_CSS__ for the lazy-load harness. */
const _cssInjected = new Set();
function ensureCss(pkg) {
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

function loadWidgets() {
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
function loadGrid() {
  ensureCss('grid');
  return (_pGrid ||= importOnce('@jects/grid').then((m) => {
    ({ Grid, summaryFeature, editingFeature, columnStateFeature, columnPickerFeature,
       filterBarFeature, filterMenuFeature, filterFacetFeature, undoRedoFeature,
       rowExpanderFeature, tooltipFeature, exportFeature, pdfExportFeature, fillFeature,
       headerGroupsFeature } = m);
  }));
}
function loadCore() {
  return (_pCore ||= importOnce('@jects/core').then((m) => { ({ TreeStore } = m); }));
}
function loadCharts() {
  ensureCss('charts');
  return (_pCharts ||= importOnce('@jects/charts').then((m) => { ({ Chart } = m); }));
}
function loadPivot() {
  ensureCss('pivot');
  return (_pPivot ||= importOnce('@jects/pivot').then((m) => { ({ PivotTable, AggregatorRegistry } = m); }));
}
function loadSpreadsheet() {
  ensureCss('spreadsheet');
  return (_pSpreadsheet ||= importOnce('@jects/spreadsheet').then((m) => { ({ Spreadsheet } = m); }));
}
function loadTimeline() {
  ensureCss('timeline-core');
  return (_pTimeline ||= importOnce('@jects/timeline-core').then((m) => { ({ HOUR_AND_DAY, WEEK_AND_DAY } = m); }));
}
function loadScheduler() {
  ensureCss('scheduler');
  return (_pScheduler ||= importOnce('@jects/scheduler').then((m) => { ({ Scheduler, SchedulerStm } = m); }));
}
function loadGantt() {
  ensureCss('gantt');
  return (_pGantt ||= importOnce('@jects/gantt').then((m) => {
    ({ Gantt, GanttProgressLineFeature, GanttIndicatorsFeature, MultiBaselineCompare,
       ProjectLines, GanttExportMenu, GanttUndoRedo, GanttRollupFeature,
       GanttSegmentedTasksFeature, ResourceHistogram, ResourceUtilizationView, PertView,
       DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS, rollupColumn, ganttToMsProjectXml } = m);
  }));
}
function loadCalendar() {
  ensureCss('calendar');
  return (_pCalendar ||= importOnce('@jects/calendar').then((m) => { ({ Calendar } = m); }));
}
function loadKanban() {
  ensureCss('kanban');
  return (_pKanban ||= importOnce('@jects/kanban').then((m) => { ({ TaskBoard } = m); }));
}
function loadDiagram() {
  ensureCss('diagram');
  return (_pDiagram ||= importOnce('@jects/diagram').then((m) => { ({ Diagram, documentToJson, downloadBlob } = m); }));
}
function loadTodo() {
  ensureCss('todo');
  return (_pTodo ||= importOnce('@jects/todo').then((m) => { ({ TodoList } = m); }));
}
function loadBooking() {
  ensureCss('booking');
  return (_pBooking ||= importOnce('@jects/booking').then((m) => { ({ Booking } = m); }));
}
function loadChatbot() {
  ensureCss('chatbot');
  return (_pChatbot ||= importOnce('@jects/chatbot').then((m) => { ({ Chatbot } = m); }));
}

/* Route id → the lazy module loader(s) that route's demo needs. A section with
   no entry (e.g. `foundations`, which is pure DOM/CSS) loads nothing and just
   builds. This table is the single source of truth for which JS each route
   pulls, so the demo build functions below stay untouched. */
const SECTION_LOADERS = {
  // foundations: none (token swatches read live CSS vars — no JS module).
  // The theme customizer previews real components from across the suite, so it
  // lazy-loads widgets (buttons/fields/badge), the grid (+core) and charts.
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
};

/* ───────────────────────── small DOM helpers ─────────────────────────── */

const root = document.getElementById('gallery');

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** A labelled demo card. `mount(host)` receives the body host element. */
function card(label, mount, { wide = false, block = false } = {}) {
  const bd = el('div', { class: 'g-card__bd' + (block ? ' is-block' : '') });
  const c = el('div', { class: 'g-card' + (wide ? ' is-wide' : '') }, [
    el('div', { class: 'g-card__hd', text: label }),
    bd,
  ]);
  try {
    mount(bd);
  } catch (err) {
    bd.appendChild(el('div', { class: 'g-note', text: 'demo error: ' + err.message }));
    console.error('[gallery] demo "' + label + '" failed:', err);
  }
  return c;
}

/** A button that triggers an overlay/imperative demo. */
function triggerBtn(text, onClick, variant = 'secondary') {
  const host = el('span');
  const b = new Button(host, { text, variant });
  b.el.addEventListener('click', onClick);
  return host;
}

/**
 * A single, reusable "Export ▾" split-format dropdown. Collapses N separate
 * export/print toolbar buttons into one accessible menu (used by the Gantt
 * built-in export menu as the UX reference). Token-only chrome.
 *
 *   bar    — toolbar element the trigger mounts into (appended for you)
 *   items  — [{ label, onClick }, …]; each item calls the SAME export method
 *            the original button called. Behaviour is unchanged — only the
 *            trigger UI is consolidated.
 *   opts   — { label = 'Export', variant = 'secondary', size = 'sm' }
 *
 * Accessibility: the trigger carries aria-haspopup="menu" + aria-expanded;
 * the panel is role="menu" with role="menuitem" children. Opens on click,
 * closes on outside-click, on Escape, and after an item runs. Full keyboard
 * nav: ↑/↓/Home/End move focus, Enter/Space activate, Esc closes & restores
 * focus to the trigger; opening with ↓/Enter focuses the first item.
 */
function exportMenu(bar, items, opts = {}) {
  const { label = 'Export', variant = 'secondary', size = 'sm' } = opts;
  const wrap = el('div', { class: 'g-exportmenu' });
  // Plain <button> styled with the house btn classes so this works in every
  // section regardless of whether the lazy Button class has loaded yet.
  const btn = el('button', {
    type: 'button',
    class: 'jects-btn jects-btn--' + variant + (size ? ' jects-btn--' + size : ''),
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    text: label + ' ▾',
  });
  wrap.appendChild(btn);

  const menu = el('div', { class: 'g-exportmenu__panel', role: 'menu', hidden: 'hidden' });
  const itemEls = items.map((it, i) => {
    const mi = el('button', {
      class: 'g-exportmenu__item', type: 'button', role: 'menuitem', tabindex: '-1', text: it.label,
    });
    mi.addEventListener('click', () => {
      close(true);
      try { it.onClick(); } catch (e) { console.warn('exportMenu item "' + it.label + '" failed:', e && e.message); }
    });
    menu.appendChild(mi);
    return mi;
  });
  wrap.appendChild(menu);
  if (bar) bar.appendChild(wrap);

  let open = false;
  const focusItem = (i) => {
    if (!itemEls.length) return;
    const n = (i + itemEls.length) % itemEls.length;
    itemEls[n].focus();
  };
  const onDocPointer = (e) => { if (!wrap.contains(e.target)) close(false); };
  function openMenu(focusFirst) {
    if (open) return;
    open = true;
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onDocPointer, true);
    if (focusFirst) focusItem(0);
  }
  function close(restoreFocus) {
    if (!open) return;
    open = false;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDocPointer, true);
    if (restoreFocus) btn.focus();
  }

  btn.addEventListener('click', () => { open ? close(false) : openMenu(false); });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu(true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); openMenu(true); focusItem(itemEls.length - 1); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); close(false); }
  });
  menu.addEventListener('keydown', (e) => {
    const idx = itemEls.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(idx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(idx - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
    else if (e.key === 'End') { e.preventDefault(); focusItem(itemEls.length - 1); }
    else if (e.key === 'Tab') { close(false); }
  });

  return { wrap, trigger: btn, close: () => close(false) };
}

/**
 * Enterprise-scale affordance for the heavy modules. Adds a PRIMARY toolbar
 * button that swaps the demo to a large, realistic dataset — built LAZILY by
 * `build(bigHost)` on first click (never at module load). The original small
 * demo is left mounted (just hidden) so first paint stays fast and nothing
 * about it can regress; the button toggles back. A count label reports the
 * dataset size and the measured build+render time. Token-only chrome.
 *
 *   bar        — toolbar element the button + count label mount into
 *   smallHost  — the existing demo's host element (hidden while enterprise is up)
 *   key        — stable id (matches the route) used for the data attr + harness
 *   count      — human label, e.g. "100,000 rows"
 *   build      — pure builder; receives the (correctly sized) big host
 *   status     — optional status-line setter
 */
function enterpriseSwap(bar, smallHost, { key, count, build, status, alsoHide = [] }) {
  let bigHost = null;
  let built = false;
  let showing = false;
  const idle = 'Load enterprise dataset · ' + count;
  const tag = el('span', { class: 'g-note', style: 'margin-left:.5rem;align-self:center' });
  const btn = new Button(bar, { text: idle, variant: 'primary', size: 'sm', icon: 'arrow-down' });
  btn.el.setAttribute('data-enterprise', key);
  bar.appendChild(tag);
  // Remember each sibling's original display so "Back to demo" restores it.
  const hideMemo = alsoHide.map((node) => [node, node.style.display]);

  btn.el.addEventListener('click', async () => {
    showing = !showing;
    if (!showing) {
      if (bigHost) bigHost.style.display = 'none';
      smallHost.style.display = '';
      hideMemo.forEach(([node, disp]) => { node.style.display = disp; });
      btn.el.textContent = idle;
      return;
    }
    hideMemo.forEach(([node]) => { node.style.display = 'none'; });
    if (!bigHost) {
      bigHost = el('div');
      bigHost.className = smallHost.className;
      const st = smallHost.getAttribute('style');
      if (st) bigHost.setAttribute('style', st);
      smallHost.insertAdjacentElement('afterend', bigHost);
    }
    smallHost.style.display = 'none';
    bigHost.style.display = '';
    btn.el.textContent = 'Back to demo';
    if (built) return;

    const loading = el('div', { class: 'g-loading', role: 'status' }, [
      el('div', { class: 'g-spinner', 'aria-hidden': 'true' }),
      el('div', { text: 'Building ' + count + '…' }),
    ]);
    bigHost.appendChild(loading);
    // Two RAFs so the loading state actually paints before the (blocking) build.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    loading.remove();
    const t0 = performance.now();
    try {
      build(bigHost);
      built = true;
      const ms = Math.round(performance.now() - t0);
      tag.textContent = count + ' · built in ' + ms + ' ms';
      if (status) status('Loaded enterprise dataset: ' + count + ' (' + ms + ' ms).');
      (window.__JECTS_ENTERPRISE__ || (window.__JECTS_ENTERPRISE__ = {}))[key] = { count, ms };
    } catch (e) {
      bigHost.appendChild(el('div', { class: 'g-note', style: 'color:oklch(var(--jects-destructive))', text: 'Enterprise build failed: ' + (e && e.message) }));
      console.error('[gallery] enterprise "' + key + '" failed:', e);
    }
  });
  return btn;
}

const SECTIONS = [];
const SECTION_NODES = new Map(); // id -> <section> element (for lazy activation)

/**
 * Register a routed section. The demo `build(grid)` is DEFERRED — it does not
 * run at module load. Instead it runs the first time the route is activated
 * (see `activateSection`), after the route's loader (from `SECTION_LOADERS`)
 * has dynamically import()ed the `@jects/*` module(s) the demo needs.
 */
function section(id, title, lede, build, { wide = false } = {}) {
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
 * re-visit never re-imports or re-renders. Import failures surface a visible
 * error (never a blank panel) and console.error.
 */
function activateSection(sec) {
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

/* ───────────────────────── shared demo data ──────────────────────────── */

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const colors = [
  { value: 'red', label: 'Red' },
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
  { value: 'violet', label: 'Violet', disabled: true },
];
const fruits = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
  { value: 'date', label: 'Date' },
  { value: 'elderberry', label: 'Elderberry' },
];
const plans = [
  { value: 'free', label: 'Free' },
  { value: 'pro', label: 'Pro' },
  { value: 'team', label: 'Team' },
];

const fileTree = [
  {
    id: 'src',
    text: 'src',
    children: [
      { id: 'index', text: 'index.ts' },
      {
        id: 'components',
        text: 'components',
        children: [
          { id: 'button', text: 'button.ts' },
          { id: 'tree', text: 'tree.ts' },
        ],
      },
    ],
  },
  { id: 'readme', text: 'README.md' },
];

const people = Array.from({ length: 9 }, (_, i) => ({
  id: i + 1,
  text: `Person ${i + 1}`,
  role: i % 2 ? 'Engineer' : 'Designer',
}));

/* Shared timing constants + the flat sales dataset — hoisted so each heavy
   module (pivot, spreadsheet, scheduler, gantt, …) can live in its OWN routed
   section/page instead of being grouped. */
const DAY = 86_400_000;
const HOUR = 3_600_000;
const sales = [
  { region: 'West', product: 'Widget', quarter: 'Q1', amount: 1200, units: 12 },
  { region: 'West', product: 'Widget', quarter: 'Q2', amount: 1800, units: 18 },
  { region: 'West', product: 'Gadget', quarter: 'Q1', amount: 600, units: 4 },
  { region: 'West', product: 'Gadget', quarter: 'Q2', amount: 1100, units: 8 },
  { region: 'East', product: 'Widget', quarter: 'Q1', amount: 2400, units: 24 },
  { region: 'East', product: 'Widget', quarter: 'Q2', amount: 2000, units: 20 },
  { region: 'East', product: 'Gadget', quarter: 'Q1', amount: 900, units: 6 },
  { region: 'East', product: 'Gadget', quarter: 'Q2', amount: 1300, units: 9 },
  { region: 'North', product: 'Widget', quarter: 'Q1', amount: 1500, units: 10 },
  { region: 'North', product: 'Gadget', quarter: 'Q2', amount: 700, units: 5 },
];

/* ───────────────── enterprise-scale dataset generators ────────────────────
   Pure functions, NEVER called at module load — each runs only when its
   section's "Load enterprise dataset" button is clicked (see enterpriseSwap).
   Deterministic (no Math.random in the row shape) so renders are reproducible. */

const FIRST_NAMES = ['Ada', 'Alan', 'Grace', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Ken',
  'Edsger', 'Donald', 'John', 'Katherine', 'Tim', 'Radia', 'Vint', 'Hedy', 'Shafi', 'Leslie'];
const LAST_NAMES = ['Lovelace', 'Turing', 'Hopper', 'Torvalds', 'Hamilton', 'Ritchie', 'Liskov',
  'Thompson', 'Dijkstra', 'Knuth', 'McCarthy', 'Johnson', 'Berners-Lee', 'Perlman', 'Cerf', 'Lamarr'];
const DEPTS = ['Engineering', 'Design', 'Product', 'Research', 'Sales', 'Marketing', 'Finance', 'Support'];
const STATUSES = ['Active', 'On leave', 'Probation', 'Contractor', 'Notice'];

/** Grid: N realistic employee rows (id · name · dept · status · salary · hire date · progress). */
function genGridRows(n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = {
      id: i + 1,
      name: FIRST_NAMES[i % FIRST_NAMES.length] + ' ' + LAST_NAMES[(i * 7) % LAST_NAMES.length],
      dept: DEPTS[i % DEPTS.length],
      status: STATUSES[(i * 3) % STATUSES.length],
      salary: 52_000 + ((i * 9173) % 188_000),
      hired: new Date(Date.UTC(2008 + (i % 18), i % 12, 1 + (i % 27))),
      progress: (i * 17) % 101,
    };
  }
  return out;
}

/** Pivot: N flat sales records over region × product × quarter × channel. */
function genPivotRecords(n) {
  const regions = ['West', 'East', 'North', 'South', 'Central'];
  const products = ['Widget', 'Gadget', 'Gizmo', 'Doohickey', 'Sprocket'];
  const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  const channels = ['Online', 'Retail', 'Partner'];
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = {
      region: regions[i % regions.length],
      product: products[(i * 3) % products.length],
      quarter: quarters[(i >> 2) % quarters.length],
      channel: channels[(i * 5) % channels.length],
      amount: 200 + ((i * 137) % 9800),
      units: 1 + ((i * 11) % 60),
    };
  }
  return out;
}

/** Gantt: a multi-phase WBS of ~`leafCount` leaf tasks with ~2× dependencies. */
function genGanttProject(leafCount) {
  const T0 = Date.UTC(2026, 0, 1);
  const PER_PHASE = 25;
  const phaseNames = ['Discovery', 'Architecture', 'Design', 'Build', 'Integration',
    'Hardening', 'Launch', 'Operations'];
  const tasks = [];
  const dependencies = [];
  let depId = 0;
  let leaves = 0;
  const phases = Math.ceil(leafCount / PER_PHASE);
  for (let p = 0; p < phases && leaves < leafCount; p++) {
    const pid = 'p' + p;
    tasks.push({ id: pid, name: phaseNames[p % phaseNames.length] + ' — wave ' + (p + 1), expanded: p < 2, rollup: true });
    const inThis = Math.min(PER_PHASE, leafCount - leaves);
    let prev = null;
    for (let j = 0; j < inThis; j++) {
      const id = 'l' + leaves;
      const off = p * 18 + j * 2;
      const dur = 2 + (j % 5);
      tasks.push({
        id, name: 'Task ' + (leaves + 1), parentId: pid,
        start: T0 + off * DAY, duration: dur * DAY, end: T0 + (off + dur) * DAY,
        percentDone: (leaves * 13) % 101,
      });
      // Primary chain (FS) within the phase.
      if (prev) dependencies.push({ id: 'k' + depId++, fromId: prev, toId: id, type: 'FS' });
      prev = id;
      leaves++;
    }
  }
  // Secondary skip-1 links across the flat leaf list (always lower→higher index,
  // so the graph stays acyclic) to roughly double the dependency count.
  for (let i = 2; i < leaves; i++) {
    dependencies.push({ id: 'k' + depId++, fromId: 'l' + (i - 2), toId: 'l' + i, type: 'SS' });
  }
  return { T0, tasks, dependencies };
}

/** Scheduler: `resCount` resources each with ~`perRes` shift/booking events. */
function genSchedulerData(resCount, perRes) {
  const base = Date.UTC(2026, 5, 1); // Mon 1 Jun 2026
  const teams = ['Field', 'Support', 'Install', 'Survey', 'Dispatch'];
  const jobs = ['On-site visit', 'Maintenance', 'Install', 'Inspection', 'Call-out', 'Survey', 'Repair', 'Handover'];
  const tints = ['cyan', 'magenta', 'yellow', null];
  const resources = new Array(resCount);
  for (let r = 0; r < resCount; r++) {
    resources[r] = {
      id: 'r' + r,
      name: FIRST_NAMES[r % FIRST_NAMES.length] + ' ' + LAST_NAMES[(r * 5) % LAST_NAMES.length],
      role: teams[r % teams.length],
      capacity: 1,
    };
  }
  const events = [];
  let e = 0;
  for (let r = 0; r < resCount; r++) {
    for (let k = 0; k < perRes; k++) {
      const day = (r + k) % 20;             // spread across ~4 working weeks
      const startHr = 8 + ((r + k * 2) % 8); // 08:00–16:00 starts
      const dur = 1 + ((r + k) % 3);         // 1–3h jobs
      const s = base + day * DAY + startHr * HOUR;
      events.push({
        id: 'ev' + e++,
        resourceId: 'r' + r,
        name: jobs[(r + k) % jobs.length] + ' #' + (k + 1),
        startDate: s,
        endDate: s + dur * HOUR,
        eventColor: tints[(r + k) % tints.length] || undefined,
      });
    }
  }
  return { base, resources, events };
}

/** Spreadsheet: a budget workbook of ~`rowCount` line items × 12 months with
 *  per-row Total (=SUM) formulas and a footer row of per-column SUM formulas. */
function genBudgetSheet(rowCount) {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const cats = ['Salaries', 'Cloud', 'Travel', 'Marketing', 'Hardware', 'Software', 'Office', 'Legal', 'R&D', 'Support'];
  const cells = {};
  const fmt = { type: 'currency', numberFormat: '#,##0' };
  // Header row.
  cells['0,0'] = { value: 'Line item', style: { bold: true } };
  MONTHS.forEach((m, i) => { cells['0,' + (i + 1)] = { value: m, style: { bold: true } }; });
  cells['0,13'] = { value: 'Total', style: { bold: true } };
  // Line-item rows (row 1..rowCount). Total col (M=13) = SUM(B..M) for that row.
  for (let r = 1; r <= rowCount; r++) {
    cells[r + ',0'] = { value: cats[(r - 1) % cats.length] + ' ' + r };
    for (let c = 1; c <= 12; c++) {
      cells[r + ',' + c] = { value: 1_000 + ((r * 131 + c * 977) % 24_000), format: fmt };
    }
    cells[r + ',13'] = { formula: 'SUM(B' + (r + 1) + ':M' + (r + 1) + ')', format: fmt, style: { bold: true } };
  }
  // Footer totals row: per-column SUM down the body + grand total.
  const f = rowCount + 1;
  cells[f + ',0'] = { value: 'Total', style: { bold: true } };
  for (let c = 1; c <= 13; c++) {
    const col = String.fromCharCode(65 + c); // B..N
    cells[f + ',' + c] = { formula: 'SUM(' + col + '2:' + col + (rowCount + 1) + ')', format: fmt, style: { bold: true } };
  }
  return { cells, rowCount: rowCount + 2, colCount: 14, populated: Object.keys(cells).length };
}

/** Kanban: `n` backlog cards spread across the given columns × lanes. */
function genKanbanCards(n, columnIds, laneIds) {
  const verbs = ['Implement', 'Fix', 'Refactor', 'Design', 'Test', 'Document', 'Investigate', 'Optimize', 'Review', 'Migrate'];
  const nouns = ['auth flow', 'billing API', 'dashboard', 'search index', 'cache layer', 'onboarding',
    'export pipeline', 'webhooks', 'rate limiter', 'theme tokens', 'grid virtualization', 'i18n'];
  const tagsPool = ['feature', 'bug', 'chore', 'p1', 'p2', 'a11y', 'perf', 'design'];
  const people = ['KM', 'AB', 'CS', 'DV', 'EP'];
  const cards = new Array(n);
  for (let i = 0; i < n; i++) {
    cards[i] = {
      id: i + 1,
      column: columnIds[i % columnIds.length],
      lane: laneIds[(i >> 1) % laneIds.length],
      order: i,
      priority: 1 + (i % 3),
      title: verbs[i % verbs.length] + ' ' + nouns[(i * 3) % nouns.length] + ' #' + (i + 1),
      assignee: people[i % people.length],
      avatar: people[i % people.length],
      progress: (i * 9) % 101,
      tags: [{ text: tagsPool[i % tagsPool.length], color: 1 + (i % 7) }],
      votes: { count: i % 11, voted: i % 4 === 0 },
    };
  }
  return cards;
}

/** Diagram: `n` nodes in a balanced flow tree + connectors (n-1 edges). */
function genDiagramGraph(n) {
  const stages = ['Intake', 'Triage', 'Review', 'Build', 'Verify', 'Ship'];
  const shapes = new Array(n);
  const connectors = [];
  for (let i = 0; i < n; i++) {
    shapes[i] = {
      id: 'n' + i,
      type: i === 0 ? 'start' : (i % 7 === 0 ? 'decision' : 'process'),
      x: 40 + (i % 12) * 150,
      y: 40 + Math.floor(i / 12) * 110,
      w: 130, h: 56,
      text: stages[i % stages.length] + ' ' + i,
    };
    if (i > 0) {
      const parent = Math.floor((i - 1) / 3); // ternary tree
      connectors.push({ id: 'e' + i, from: { shape: 'n' + parent }, to: { shape: 'n' + i }, kind: 'orthogonal', arrows: { end: 'arrow' } });
    }
  }
  return { shapes, connectors };
}

/* ════════════════════════ SECTIONS ════════════════════════════════════ */
const main = el('main', { class: 'g-main' });

/* ── Foundations ───────────────────────────────────────────────────────── */
main.appendChild(
  section(
    'foundations',
    'Foundations',
    'The house token contract (--jects-*). Swatches read live CSS custom properties, so they restyle with the theme switcher and the primary / radius controls above.',
    (grid) => {
      const semantic = [
        'background', 'foreground', 'card', 'primary', 'secondary', 'muted',
        'accent', 'destructive', 'success', 'warning', 'border', 'ring',
      ];
      const cmyk = ['cmyk-cyan', 'cmyk-magenta', 'cmyk-yellow', 'cmyk-key',
        'cmyk-cyan-soft', 'cmyk-magenta-soft', 'cmyk-yellow-soft', 'cmyk-key-soft'];
      const ramp = ['data-1', 'data-2', 'data-3', 'data-4', 'data-5', 'data-6', 'data-7', 'data-8'];

      const swatchBlock = (names) => {
        const wrap = el('div', { class: 'g-swatches' });
        for (const name of names) {
          wrap.appendChild(
            el('div', { class: 'g-swatch' }, [
              el('div', { class: 'chip', style: `background:oklch(var(--jects-${name}))` }),
              el('div', { class: 'meta' }, [
                el('b', { text: name }),
                el('span', { text: `--jects-${name}` }),
              ]),
            ]),
          );
        }
        return wrap;
      };

      grid.appendChild(card('Semantic tokens', (h) => h.appendChild(swatchBlock(semantic)), { block: true }));
      grid.appendChild(card('Calm CMYK palette', (h) => h.appendChild(swatchBlock(cmyk)), { block: true }));
      grid.appendChild(card('Chart data ramp (data-1 … data-8)', (h) => h.appendChild(swatchBlock(ramp)), { block: true }));
    },
  ),
);

/* ── Theme customizer (ENRICHED) ────────────────────────────────────────────
   A first-class, live, exportable design-system control surface. Every control
   writes @jects/theme overrides onto a single PREVIEW SCOPE element; because the
   `--jects-*` custom properties inherit, every real component mounted inside
   that scope restyles in real time from one set of tokens. The customizer drives
   THREE token tiers — primitive scales, semantic colors, and (Phase A) the
   component tier (border-width, ring, density, control + table tokens) — so it
   can restyle padding, outlines and tables, not just colors.

   Sections are collapsible + searchable; per-section reset; Import parses a
   pasted theme.css / token list; a WCAG contrast checker grades fg/bg pairs;
   share-URL encodes the live override set into the location hash; export emits
   the full overridden token set. Token-only chrome throughout. */

/* Color tokens are stored as OKLCH triplets; the swatch UI works in hex. We
   keep a default-hex per color token so the swatch shows a sensible start and
   import can round-trip. Hex<->oklch is lossy one-way (we only need oklch out),
   so colorControl tracks the raw token value for export and only displays hex. */
const CZ_SEMANTIC = [
  // [token, label, defaultHex]  — grouped: base, then each base+foreground pair
  ['background', 'Background', '#ffffff'],
  ['foreground', 'Foreground', '#18181b'],
  ['card', 'Card', '#ffffff'],
  ['card-foreground', 'Card fg', '#18181b'],
  ['popover', 'Popover', '#ffffff'],
  ['popover-foreground', 'Popover fg', '#18181b'],
  ['primary', 'Primary', '#3b3b46'],
  ['primary-foreground', 'Primary fg', '#fafafa'],
  ['secondary', 'Secondary', '#f4f4f5'],
  ['secondary-foreground', 'Secondary fg', '#3b3b46'],
  ['muted', 'Muted', '#f4f4f5'],
  ['muted-foreground', 'Muted fg', '#71717a'],
  ['accent', 'Accent', '#8b5cf6'],
  ['accent-foreground', 'Accent fg', '#3b3b46'],
  ['destructive', 'Destructive', '#dc2626'],
  ['destructive-foreground', 'Destructive fg', '#fafafa'],
  ['success', 'Success', '#16a34a'],
  ['success-foreground', 'Success fg', '#fafafa'],
  ['warning', 'Warning', '#d4a72c'],
  ['warning-foreground', 'Warning fg', '#3b3b46'],
  ['border', 'Border', '#e4e4e7'],
  ['input', 'Input', '#e4e4e7'],
  ['ring', 'Ring', '#a1a1aa'],
];

const CZ_DATA = [
  ['data-1', 'Data 1', '#1f9fc7'], ['data-2', 'Data 2', '#c74f8a'],
  ['data-3', 'Data 3', '#d4a72c'], ['data-4', 'Data 4', '#3b3b46'],
  ['data-5', 'Data 5', '#3a7bd5'], ['data-6', 'Data 6', '#a64dad'],
  ['data-7', 'Data 7', '#7ab648'], ['data-8', 'Data 8', '#4a4a55'],
];
const CZ_CMYK = [
  ['cmyk-cyan', 'Cyan', '#1f9fc7'], ['cmyk-magenta', 'Magenta', '#c74f8a'],
  ['cmyk-yellow', 'Yellow', '#d4a72c'], ['cmyk-key', 'Key', '#3b3b46'],
];

const CZ_FONTS = [
  { value: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', label: 'System sans' },
  { value: 'Georgia, "Times New Roman", Times, serif', label: 'Serif' },
  { value: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace', label: 'Monospace' },
  { value: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif', label: 'Geometric' },
];
const CZ_MONO_FONTS = [
  { value: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace', label: 'System mono' },
  { value: '"Courier New", Courier, monospace', label: 'Courier' },
  { value: '"Cascadia Code", "Fira Code", ui-monospace, monospace', label: 'Cascadia / Fira' },
];

/* Scalar control defaults (the values per-section Reset restores). */
const CZ_DEFAULTS = {
  base: 'light',
  radius: 10,        // px
  fontFamily: CZ_FONTS[0].value,
  fontFamilyMono: CZ_MONO_FONTS[0].value,
  fontSize: 16,      // px (base font-size-md)
  weightNormal: 400, weightMedium: 500, weightSemibold: 600, weightBold: 700,
  lineHeight: 1.5,
  letterSpacing: 0,  // em x100 (slider in /100 em)
  spacing: 4,        // px step (space-1)
  density: 1,        // scalar
  borderWidth: 1,    // px
  ringWidth: 2,      // px
  ringOffset: 2,     // px
  borderColor: '#e4e4e7',
  ringColor: '#a1a1aa',
  tableHeaderBg: '#f4f4f5',
  tableRowStripe: '#f4f4f5',
  tableRowHover: '#ede9fe',
  tableBorder: '#e4e4e7',
  tableCellPadX: 12, // px
  shadow: 'md',
  motion: 'normal',
};

/* The full token set serialised into the exported theme.css. Extended to the
   new groups (data/cmyk ramps, weights, line-height/letter-spacing, density +
   control + border/ring + table tokens, shadows, motion). exportThemeCss only
   emits tokens that resolve to a non-empty computed value, so listing the full
   universe here is safe — only OVERRIDDEN ones (and base ones present) appear. */
const CZ_EXPORT_TOKENS = [
  ...CZ_SEMANTIC.map((c) => c[0]),
  ...CZ_DATA.map((c) => c[0]),
  ...CZ_CMYK.map((c) => c[0]),
  'cmyk-cyan-soft', 'cmyk-magenta-soft', 'cmyk-yellow-soft', 'cmyk-key-soft',
  'radius', 'radius-sm', 'radius-md', 'radius-lg', 'radius-xl',
  'font-family', 'font-family-mono',
  'font-size-xs', 'font-size-sm', 'font-size-md', 'font-size-lg', 'font-size-xl', 'font-size-2xl',
  'font-weight-normal', 'font-weight-medium', 'font-weight-semibold', 'font-weight-bold',
  'line-height', 'letter-spacing',
  'space-1', 'space-2', 'space-3', 'space-4', 'space-5', 'space-6',
  'space-7', 'space-8', 'space-9', 'space-10', 'space-11', 'space-12',
  'density', 'control-height', 'control-padding-x', 'control-padding-y',
  'border-width', 'ring-width', 'ring-offset',
  'table-header-bg', 'table-row-stripe', 'table-row-hover', 'table-border',
  'table-cell-padding-x', 'table-cell-padding-y', 'table-row-height',
  'shadow-sm', 'shadow-md', 'shadow-lg',
  'duration-fast', 'duration-normal', 'duration-slow',
];

/* WCAG relative-luminance contrast on hex pairs (sRGB). */
function czContrastRatio(hexA, hexB) {
  const lum = (hex) => {
    const m = hex.replace('#', '');
    if (m.length < 6) return null;
    const ch = [0, 2, 4].map((i) => {
      const c = parseInt(m.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const la = lum(hexA), lb = lum(hexB);
  if (la == null || lb == null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

main.appendChild(
  section(
    'customizer',
    'Theme customizer',
    'A full design-system control surface. Edit colors, typography, spacing, density, borders, outlines, tables, elevation and motion across collapsible groups — every real component below restyles live from one token set. Import a theme, check WCAG contrast, share a link, or download a ready-to-ship theme.css.',
    (grid) => {
      const wrap = el('div', { class: 'g-customizer' });

      /* The single preview SCOPE. setTheme()/applyTheme() target this element. */
      const scope = el('div', { class: 'g-cz-preview jects-scope', 'data-jects-scope': '', 'data-cz-scope': '' });
      setTheme('light', scope);

      /* Generated-CSS code area (declared early so handlers can refresh it). */
      const code = el('textarea', { class: 'g-cz-code', readonly: 'readonly', spellcheck: 'false', 'aria-label': 'Generated theme.css', 'data-cz-code': '' });

      /* Live override registry — token name → raw value (for share-URL + import). */
      const overrides = {};
      const setOverride = (name, value) => { overrides[name] = value; };

      /* Per-section reset registry: each section pushes a fn that restores its
         controls + clears its tokens. */
      const sectionResetters = {};

      let updateContrast = () => {};
      let updateShareUrl = () => {};
      let suspendShare = false;
      const refreshExport = () => {
        code.value = exportThemeCss(scope, CZ_EXPORT_TOKENS, ':root');
        updateContrast();
        if (!suspendShare) updateShareUrl();
      };

      /* apply: write tokens to the scope, record overrides, refresh side panels. */
      const apply = (map) => {
        applyTheme(scope, map);
        for (const k in map) setOverride(k, map[k]);
        refreshExport();
      };

      /* ───────────────────────── collapsible group factory ──────────────── */
      const groups = []; // {id, body, titleEl, rows:[{label, node}]}
      const makeGroup = (id, title, { open = false } = {}) => {
        const body = el('div', { class: 'g-cz-group-body' });
        const reset = el('button', { type: 'button', class: 'g-cz-secreset', title: 'Reset this section', 'aria-label': 'Reset ' + title, text: 'Reset' });
        reset.addEventListener('click', (e) => {
          e.stopPropagation();
          const fn = sectionResetters[id];
          if (fn) fn();
        });
        const caret = el('span', { class: 'g-cz-caret', 'aria-hidden': 'true', text: '▸' });
        const titleSpan = el('span', { class: 'g-cz-group-title', text: title });
        const head = el('button', { type: 'button', class: 'g-cz-group-hd', 'aria-expanded': open ? 'true' : 'false', 'data-cz-group': id }, [caret, titleSpan]);
        const headWrap = el('div', { class: 'g-cz-group-headwrap' }, [head, reset]);
        head.addEventListener('click', () => {
          const isOpen = head.getAttribute('aria-expanded') === 'true';
          head.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
        });
        const groupEl = el('div', { class: 'g-cz-group', 'data-cz-groupwrap': id }, [headWrap, body]);
        if (open) head.setAttribute('aria-expanded', 'true');
        const rec = { id, title, body, head, titleSpan, rows: [], groupEl };
        groups.push(rec);
        return rec;
      };

      /* — control factories scoped to a group's body — */
      const rowIn = (g, label, inputEl) => {
        const node = el('div', { class: 'g-cz-row', 'data-cz-ctl': (label || '').toLowerCase() }, [
          el('label', { class: 'g-cz-label', text: label }),
          inputEl,
        ]);
        g.body.appendChild(node);
        g.rows.push({ label: (label || '').toLowerCase(), node });
        return node;
      };

      // Color control: token is a SEMANTIC triplet OR a FULL oklch() string.
      // mode 'triplet' → applies hexToOklchTriplet; mode 'full' → oklch(<triplet>).
      const colorControl = (g, token, label, defHex, mode = 'triplet') => {
        const inp = el('input', { type: 'color', class: 'g-cz-color', value: defHex, 'aria-label': label, 'data-cz-color': token });
        const hex = el('input', { type: 'text', class: 'g-cz-hex', value: defHex, spellcheck: 'false', maxlength: '7', 'aria-label': label + ' hex' });
        let lastHex = defHex;
        const toToken = (h) => (mode === 'full' ? 'oklch(' + hexToOklchTriplet(h) + ')' : hexToOklchTriplet(h));
        const push = (h) => { lastHex = h; apply({ [token]: toToken(h) }); };
        inp.addEventListener('input', () => { hex.value = inp.value; push(inp.value); });
        hex.addEventListener('input', () => {
          let v = hex.value.trim(); if (v && v[0] !== '#') v = '#' + v;
          if (/^#[0-9a-fA-F]{3}$/.test(v)) v = '#' + v.slice(1).split('').map((c) => c + c).join('');
          if (/^#[0-9a-fA-F]{6}$/.test(v)) { inp.value = v; push(v); }
        });
        const setHex = (v) => { inp.value = v; hex.value = v; lastHex = v; };
        rowIn(g, label, el('span', { class: 'g-cz-colorwrap' }, [inp, hex]));
        return { token, setHex, getHex: () => lastHex, defHex };
      };

      const rangeControl = (g, label, def, min, max, step, applyFn, unit, fmt) => {
        const out = el('span', { class: 'g-cz-out' });
        const inp = el('input', { type: 'range', class: 'g-cz-range', min: String(min), max: String(max), step: String(step), value: String(def), 'aria-label': label });
        const sync = () => { out.textContent = (fmt ? fmt(inp.value) : inp.value) + (unit || ''); };
        inp.addEventListener('input', () => { applyFn(inp.value); sync(); });
        sync();
        rowIn(g, label, el('span', { class: 'g-cz-rangewrap' }, [inp, out]));
        return { inp, sync, def };
      };

      const selectControl = (g, label, options, def, onChange) => {
        const sel = el('select', { class: 'g-cz-select', 'aria-label': label });
        options.forEach((o) => sel.appendChild(el('option', { value: o.value, text: o.label })));
        sel.value = def;
        sel.addEventListener('change', () => onChange(sel.value));
        rowIn(g, label, sel);
        return sel;
      };

      const segControl = (g, label, options, def, onChange, attr) => {
        const seg = el('div', { class: 'g-seg g-cz-seg' });
        options.forEach(([value, lbl]) => {
          const b = el('button', { type: 'button', text: lbl, 'aria-pressed': value === def ? 'true' : 'false' });
          if (attr) b.setAttribute(attr, value);
          b.addEventListener('click', () => {
            seg.querySelectorAll('button').forEach((n) => n.setAttribute('aria-pressed', 'false'));
            b.setAttribute('aria-pressed', 'true');
            onChange(value);
          });
          seg.appendChild(b);
        });
        const setActive = (value) => seg.querySelectorAll('button').forEach((n, i) =>
          n.setAttribute('aria-pressed', options[i][0] === value ? 'true' : 'false'));
        rowIn(g, label, seg);
        return { seg, setActive };
      };

      const clearTokens = (names) => { clearTheme(scope, names); names.forEach((n) => { delete overrides[n]; }); };

      /* ════════════════════ GROUP 1 — Base & presets ═════════════════════ */
      const gBase = makeGroup('base', 'Base & presets', { open: true });
      const BASES = [['light', 'Light'], ['dark', 'Dark'], ['light-hc', 'High contrast']];
      let currentBase = 'light';
      const baseSeg = segControl(gBase, 'Base', BASES, 'light', (v) => {
        currentBase = v; setTheme(v, scope); refreshExport();
      }, 'data-cz-base');

      // Preset starting points — apply a small curated override bundle.
      const PRESETS = {
        bootstrap: { primary: '#0d6efd', accent: '#6610f2', radius: 6, label: 'Bootstrap' },
        refined: { primary: '#6d28d9', accent: '#db2777', radius: 14, label: 'Refined' },
        corporate: { primary: '#1e3a5f', accent: '#0891b2', radius: 4, label: 'Corporate' },
      };
      const presetSel = el('select', { class: 'g-cz-select', 'aria-label': 'Start from preset' });
      presetSel.appendChild(el('option', { value: '', text: 'Start from preset…' }));
      Object.entries(PRESETS).forEach(([k, p]) => presetSel.appendChild(el('option', { value: k, text: p.label })));
      presetSel.addEventListener('change', () => {
        const p = PRESETS[presetSel.value];
        if (!p) return;
        apply({ primary: hexToOklchTriplet(p.primary), ring: hexToOklchTriplet(p.primary),
                accent: hexToOklchTriplet(p.accent), radius: p.radius + 'px' });
        presetSel.value = '';
      });
      rowIn(gBase, 'Preset', presetSel);

      // Import — parse pasted theme.css / token list and apply.
      const importTa = el('textarea', { class: 'g-cz-import', spellcheck: 'false', placeholder: 'Paste theme.css or --jects-* overrides here…', 'aria-label': 'Import tokens', 'data-cz-import': '' });
      const importNote = el('span', { class: 'g-cz-note', 'data-cz-import-note': '' });
      const importBtn = el('button', { type: 'button', class: 'g-cz-btn', text: 'Import', 'data-cz-import-apply': '' });
      importBtn.addEventListener('click', () => {
        const text = importTa.value;
        const re = /--jects-([a-z0-9-]+)\s*:\s*([^;}\n]+)/gi;
        let m, count = 0; const map = {};
        while ((m = re.exec(text)) !== null) { map[m[1]] = m[2].trim(); count++; }
        if (count) {
          apply(map);
          // reflect imported color swatches where we track them
          syncColorSwatchesFromScope();
          importNote.textContent = 'Imported ' + count + ' token' + (count === 1 ? '' : 's');
        } else {
          importNote.textContent = 'No --jects-* tokens found';
        }
        setTimeout(() => { importNote.textContent = ''; }, 2600);
      });
      const importRow = el('div', { class: 'g-cz-row g-cz-row--block' }, [
        el('label', { class: 'g-cz-label', text: 'Import' }),
        el('div', { class: 'g-cz-importwrap' }, [importTa, el('div', { class: 'g-cz-cluster' }, [importBtn, importNote])]),
      ]);
      gBase.body.appendChild(importRow);
      gBase.rows.push({ label: 'import', node: importRow });

      sectionResetters.base = () => {
        clearTokens(['primary', 'ring', 'accent', 'radius']);
        currentBase = 'light'; setTheme('light', scope); baseSeg.setActive('light');
        refreshExport();
      };

      /* ════════════════ GROUP 2 — Brand & semantic colors ════════════════ */
      const gColors = makeGroup('colors', 'Brand & semantic colors');
      const colorCtls = []; // for import-sync + reset
      CZ_SEMANTIC.forEach(([token, label, defHex]) => {
        const c = colorControl(gColors, token, label, defHex, 'triplet');
        colorCtls.push(c);
      });
      sectionResetters.colors = () => {
        clearTokens(CZ_SEMANTIC.map((c) => c[0]));
        colorCtls.forEach((c) => c.setHex(c.defHex));
        refreshExport();
      };

      /* ════════════════ GROUP 3 — Data & chart ramps ═════════════════════ */
      const gData = makeGroup('data', 'Data & chart ramps');
      const dataCtls = [];
      CZ_DATA.forEach(([t, l, d]) => dataCtls.push(colorControl(gData, t, l, d, 'triplet')));
      CZ_CMYK.forEach(([t, l, d]) => dataCtls.push(colorControl(gData, t, l, d, 'triplet')));
      sectionResetters.data = () => {
        clearTokens([...CZ_DATA, ...CZ_CMYK].map((c) => c[0]));
        dataCtls.forEach((c) => c.setHex(c.defHex));
        refreshExport();
      };

      /* ════════════════════════ GROUP 4 — Typography ═════════════════════ */
      const gType = makeGroup('typography', 'Typography');
      const fontSel = selectControl(gType, 'Font family', CZ_FONTS, CZ_DEFAULTS.fontFamily, (v) => apply({ 'font-family': v }));
      const monoSel = selectControl(gType, 'Mono family', CZ_MONO_FONTS, CZ_DEFAULTS.fontFamilyMono, (v) => apply({ 'font-family-mono': v }));
      const FS_RATIOS = { 'font-size-xs': 0.75, 'font-size-sm': 0.875, 'font-size-md': 1, 'font-size-lg': 1.125, 'font-size-xl': 1.25, 'font-size-2xl': 1.5 };
      const fontSizeCtl = rangeControl(gType, 'Base size', CZ_DEFAULTS.fontSize, 12, 20, 1, (v) => {
        const base = Number(v) || 16; const o = {};
        for (const k in FS_RATIOS) o[k] = +(FS_RATIOS[k] * base).toFixed(2) + 'px';
        apply(o);
      }, 'px');
      const wNormal = rangeControl(gType, 'Weight normal', CZ_DEFAULTS.weightNormal, 100, 900, 50, (v) => apply({ 'font-weight-normal': v }));
      const wMedium = rangeControl(gType, 'Weight medium', CZ_DEFAULTS.weightMedium, 100, 900, 50, (v) => apply({ 'font-weight-medium': v }));
      const wSemibold = rangeControl(gType, 'Weight semibold', CZ_DEFAULTS.weightSemibold, 100, 900, 50, (v) => apply({ 'font-weight-semibold': v }));
      const wBold = rangeControl(gType, 'Weight bold', CZ_DEFAULTS.weightBold, 100, 900, 50, (v) => apply({ 'font-weight-bold': v }));
      const lhCtl = rangeControl(gType, 'Line height', CZ_DEFAULTS.lineHeight, 1, 2.2, 0.05, (v) => apply({ 'line-height': v }), '', (v) => Number(v).toFixed(2));
      const lsCtl = rangeControl(gType, 'Letter spacing', CZ_DEFAULTS.letterSpacing, -5, 15, 1, (v) => apply({ 'letter-spacing': (Number(v) / 100) + 'em' }), 'em', (v) => (Number(v) / 100).toFixed(2));
      sectionResetters.typography = () => {
        clearTokens([...Object.keys(FS_RATIOS), 'font-family', 'font-family-mono',
          'font-weight-normal', 'font-weight-medium', 'font-weight-semibold', 'font-weight-bold',
          'line-height', 'letter-spacing']);
        fontSel.value = CZ_DEFAULTS.fontFamily; monoSel.value = CZ_DEFAULTS.fontFamilyMono;
        [fontSizeCtl, wNormal, wMedium, wSemibold, wBold, lhCtl, lsCtl].forEach((c) => { c.inp.value = String(c.def); c.sync(); });
        refreshExport();
      };

      /* ═══════════════════ GROUP 5 — Spacing & density ═══════════════════ */
      const gSpace = makeGroup('spacing', 'Spacing & density');
      const applySpacing = (stepPx) => { const map = {}; for (let i = 1; i <= 12; i++) map['space-' + i] = (i * Number(stepPx)) + 'px'; apply(map); };
      const spacingCtl = rangeControl(gSpace, 'Spacing step', CZ_DEFAULTS.spacing, 2, 10, 1, (v) => applySpacing(v), 'px');
      const DENSITY = [['0.85', 'Compact'], ['1', 'Cozy'], ['1.15', 'Comfortable']];
      const densitySeg = segControl(gSpace, 'Density', DENSITY, '1', (v) => apply({ density: v }), 'data-cz-density');
      sectionResetters.spacing = () => {
        const names = []; for (let i = 1; i <= 12; i++) names.push('space-' + i);
        clearTokens([...names, 'density']);
        spacingCtl.inp.value = String(spacingCtl.def); spacingCtl.sync();
        densitySeg.setActive('1');
        refreshExport();
      };

      /* ═══════════════════════════ GROUP 6 — Radius ══════════════════════ */
      const gRadius = makeGroup('radius', 'Radius');
      const radiusCtl = rangeControl(gRadius, 'Radius', CZ_DEFAULTS.radius, 0, 24, 1, (v) => apply({ radius: v + 'px' }), 'px');
      sectionResetters.radius = () => {
        clearTokens(['radius']); radiusCtl.inp.value = String(radiusCtl.def); radiusCtl.sync(); refreshExport();
      };

      /* ══════════════════ GROUP 7 — Borders & outlines ═══════════════════ */
      const gBorders = makeGroup('borders', 'Borders & outlines');
      const borderWCtl = rangeControl(gBorders, 'Border width', CZ_DEFAULTS.borderWidth, 0, 6, 1, (v) => apply({ 'border-width': v + 'px' }), 'px');
      const borderColorCtl = colorControl(gBorders, 'border', 'Border color', CZ_DEFAULTS.borderColor, 'triplet');
      const ringColorCtl = colorControl(gBorders, 'ring', 'Ring color', CZ_DEFAULTS.ringColor, 'triplet');
      const ringWCtl = rangeControl(gBorders, 'Ring width', CZ_DEFAULTS.ringWidth, 0, 8, 1, (v) => apply({ 'ring-width': v + 'px' }), 'px');
      const ringOCtl = rangeControl(gBorders, 'Ring offset', CZ_DEFAULTS.ringOffset, 0, 8, 1, (v) => apply({ 'ring-offset': v + 'px' }), 'px');
      sectionResetters.borders = () => {
        clearTokens(['border-width', 'ring-width', 'ring-offset', 'border', 'ring']);
        [borderWCtl, ringWCtl, ringOCtl].forEach((c) => { c.inp.value = String(c.def); c.sync(); });
        borderColorCtl.setHex(borderColorCtl.defHex); ringColorCtl.setHex(ringColorCtl.defHex);
        refreshExport();
      };

      /* ════════════════════════════ GROUP 8 — Tables ════════════════════ */
      const gTables = makeGroup('tables', 'Tables');
      const tHeaderCtl = colorControl(gTables, 'table-header-bg', 'Header bg', CZ_DEFAULTS.tableHeaderBg, 'full');
      const tStripeCtl = colorControl(gTables, 'table-row-stripe', 'Row stripe', CZ_DEFAULTS.tableRowStripe, 'full');
      const tHoverCtl = colorControl(gTables, 'table-row-hover', 'Row hover', CZ_DEFAULTS.tableRowHover, 'full');
      const tBorderCtl = colorControl(gTables, 'table-border', 'Grid border', CZ_DEFAULTS.tableBorder, 'full');
      const tPadCtl = rangeControl(gTables, 'Cell padding', CZ_DEFAULTS.tableCellPadX, 2, 28, 1, (v) => apply({ 'table-cell-padding-x': v + 'px' }), 'px');
      sectionResetters.tables = () => {
        clearTokens(['table-header-bg', 'table-row-stripe', 'table-row-hover', 'table-border', 'table-cell-padding-x']);
        [tHeaderCtl, tStripeCtl, tHoverCtl, tBorderCtl].forEach((c) => c.setHex(c.defHex));
        tPadCtl.inp.value = String(tPadCtl.def); tPadCtl.sync();
        refreshExport();
      };

      /* ══════════════════════════ GROUP 9 — Elevation ═══════════════════ */
      const gElev = makeGroup('elevation', 'Elevation');
      const SHADOWS = {
        sm: { sm: '0 1px 1px 0 oklch(0.145 0.006 272 / 0.04)', md: '0 1px 2px 0 oklch(0.145 0.006 272 / 0.06)', lg: '0 2px 4px -1px oklch(0.145 0.006 272 / 0.08)' },
        md: null, // null = clear (use base defaults)
        lg: { sm: '0 2px 4px 0 oklch(0.145 0.006 272 / 0.08)', md: '0 8px 12px -2px oklch(0.145 0.006 272 / 0.14), 0 4px 6px -3px oklch(0.145 0.006 272 / 0.12)', lg: '0 20px 28px -6px oklch(0.145 0.006 272 / 0.18), 0 8px 12px -6px oklch(0.145 0.006 272 / 0.14)' },
      };
      const elevSeg = segControl(gElev, 'Shadow', [['sm', 'Subtle'], ['md', 'Default'], ['lg', 'Dramatic']], 'md', (v) => {
        if (v === 'md') { clearTokens(['shadow-sm', 'shadow-md', 'shadow-lg']); refreshExport(); }
        else { const s = SHADOWS[v]; apply({ 'shadow-sm': s.sm, 'shadow-md': s.md, 'shadow-lg': s.lg }); }
      }, 'data-cz-shadow');
      sectionResetters.elevation = () => { clearTokens(['shadow-sm', 'shadow-md', 'shadow-lg']); elevSeg.setActive('md'); refreshExport(); };

      /* ════════════════════════════ GROUP 10 — Motion ═══════════════════ */
      const gMotion = makeGroup('motion', 'Motion');
      const MOTION = {
        fast: { fast: '60ms', normal: '100ms', slow: '160ms' },
        normal: null,
        slow: { fast: '220ms', normal: '360ms', slow: '560ms' },
      };
      const motionSeg = segControl(gMotion, 'Duration', [['fast', 'Fast'], ['normal', 'Default'], ['slow', 'Slow']], 'normal', (v) => {
        if (v === 'normal') { clearTokens(['duration-fast', 'duration-normal', 'duration-slow']); refreshExport(); }
        else { const m = MOTION[v]; apply({ 'duration-fast': m.fast, 'duration-normal': m.normal, 'duration-slow': m.slow }); }
      }, 'data-cz-motion');
      sectionResetters.motion = () => { clearTokens(['duration-fast', 'duration-normal', 'duration-slow']); motionSeg.setActive('normal'); refreshExport(); };

      /* ───── sync swatches from the scope's computed colors (after import) ── */
      function hexFromToken(token) {
        // best-effort: read computed oklch triplet → not trivially back to hex,
        // so we leave swatches as-is; import still applies tokens live. This is a
        // no-op placeholder kept so importBtn can call it without throwing.
        void token;
      }
      function syncColorSwatchesFromScope() { void hexFromToken; }

      /* ───────────────────────── search / filter ────────────────────────── */
      const search = el('input', { type: 'search', class: 'g-cz-search', placeholder: 'Filter tokens…', 'aria-label': 'Filter tokens', 'data-cz-search': '' });
      const applyFilter = () => {
        const q = search.value.trim().toLowerCase();
        groups.forEach((g) => {
          if (!q) {
            g.groupEl.style.display = '';
            g.rows.forEach((r) => { r.node.style.display = ''; });
            return;
          }
          const titleHit = g.title.toLowerCase().includes(q);
          let any = false;
          g.rows.forEach((r) => {
            const hit = titleHit || r.label.includes(q);
            r.node.style.display = hit ? '' : 'none';
            if (hit) any = true;
          });
          g.groupEl.style.display = any ? '' : 'none';
          if (any) g.head.setAttribute('aria-expanded', 'true');
        });
      };
      search.addEventListener('input', applyFilter);

      /* ───────────────────────── controls panel assembly ────────────────── */
      const controlsInner = el('div', { class: 'g-cz-controls' });
      groups.forEach((g) => controlsInner.appendChild(g.groupEl));

      const globalReset = el('button', { type: 'button', class: 'g-cz-btn', text: 'Reset all', 'data-cz-reset': '' });
      globalReset.addEventListener('click', () => {
        clearTheme(scope, CZ_EXPORT_TOKENS);
        for (const k in overrides) delete overrides[k];
        setTheme('light', scope); currentBase = 'light';
        Object.values(sectionResetters).forEach((fn) => fn());
        baseSeg.setActive('light');
        refreshExport();
      });

      const controlsCard = el('div', { class: 'g-cz-panel' }, [
        el('div', { class: 'g-cz-panel-hd', text: 'Tokens' }),
        search,
        controlsInner,
        el('div', { class: 'g-cz-cluster', style: 'margin-top:.75rem' }, [globalReset]),
      ]);

      /* ═══════════════════ live multi-component preview ══════════════════ */
      // Per-component focus selector.
      const focusSel = el('select', { class: 'g-cz-select g-cz-focus', 'aria-label': 'Focus preview component', 'data-cz-focus': '' });
      [['all', 'Show all'], ['controls', 'Controls only'], ['grid', 'Grid only'], ['chart', 'Chart only']]
        .forEach(([v, l]) => focusSel.appendChild(el('option', { value: v, text: l })));

      const pv = el('div', { class: 'g-cz-pvgrid' });

      // Buttons + badges
      const btnCard = el('div', { class: 'g-cz-card', 'data-cz-card': 'controls' });
      btnCard.appendChild(el('div', { class: 'g-cz-card-hd', text: 'Buttons & badges' }));
      const btnRow = el('div', { class: 'g-cz-cluster', 'data-cz-buttons': '' });
      new Button(btnRow, { text: 'Primary', variant: 'primary' });
      new Button(btnRow, { text: 'Secondary', variant: 'secondary' });
      new Button(btnRow, { text: 'Outline', variant: 'outline' });
      new Button(btnRow, { text: 'Delete', variant: 'destructive', icon: 'trash' });
      new Button(btnRow, { text: 'Ghost', variant: 'ghost' });
      btnCard.appendChild(btnRow);
      const badgeRow = el('div', { class: 'g-cz-cluster' });
      new Badge(badgeRow, { text: 'Active', variant: 'success', dot: true });
      new Badge(badgeRow, { text: 'Cyan', variant: 'cyan' });
      new Badge(badgeRow, { text: 'Warning', variant: 'warning' });
      new Avatar(badgeRow, { name: 'Ada Lovelace' });
      btnCard.appendChild(badgeRow);
      pv.appendChild(btnCard);

      // Fields cluster
      const formCard = el('div', { class: 'g-cz-card', 'data-cz-card': 'controls' });
      formCard.appendChild(el('div', { class: 'g-cz-card-hd', text: 'Form fields' }));
      const fieldHost = el('div', { class: 'g-cz-fields' });
      new TextField(fieldHost, { label: 'Email', value: 'jane@example.com', inputType: 'email', clearable: true });
      new Select(fieldHost, { options: colors, placeholder: 'Choose a color', ariaLabel: 'Color', value: 'blue' });
      new Switch(fieldHost, { label: 'Notifications', checked: true });
      new Slider(fieldHost, { min: 0, max: 100, value: 60, label: 'Budget' });
      formCard.appendChild(fieldHost);
      pv.appendChild(formCard);

      // Surfaces card — exercises card/popover/muted + shadow tokens.
      const surfCard = el('div', { class: 'g-cz-card', 'data-cz-card': 'controls' });
      surfCard.appendChild(el('div', { class: 'g-cz-card-hd', text: 'Surfaces & elevation' }));
      const surfRow = el('div', { class: 'g-cz-surfrow' }, [
        el('div', { class: 'g-cz-surf g-cz-surf--sm', text: 'shadow-sm' }),
        el('div', { class: 'g-cz-surf g-cz-surf--md', text: 'shadow-md' }),
        el('div', { class: 'g-cz-surf g-cz-surf--lg', text: 'shadow-lg' }),
      ]);
      surfCard.appendChild(surfRow);
      pv.appendChild(surfCard);

      // Grid
      const gridCard = el('div', { class: 'g-cz-card', 'data-cz-card': 'grid' });
      gridCard.appendChild(el('div', { class: 'g-cz-card-hd', text: 'Grid' }));
      const gridHost = el('div', { class: 'g-cz-gridhost' });
      gridCard.appendChild(gridHost);
      pv.appendChild(gridCard);

      // Chart
      const chartCard = el('div', { class: 'g-cz-card', 'data-cz-card': 'chart' });
      chartCard.appendChild(el('div', { class: 'g-cz-card-hd', text: 'Chart' }));
      const chartHost = el('div', { class: 'g-cz-charthost' });
      chartCard.appendChild(chartHost);
      pv.appendChild(chartCard);

      scope.appendChild(pv);

      focusSel.addEventListener('change', () => {
        const v = focusSel.value;
        pv.querySelectorAll('[data-cz-card]').forEach((c) => {
          c.style.display = (v === 'all' || c.getAttribute('data-cz-card') === v) ? '' : 'none';
        });
      });

      const previewCard = el('div', { class: 'g-cz-panel g-cz-previewpanel' }, [
        el('div', { class: 'g-cz-panel-hd g-cz-pvhd' }, [
          el('span', { text: 'Live preview' }),
          focusSel,
        ]),
        scope,
      ]);

      /* ═══════════════════════ contrast checker ═════════════════════════ */
      const contrastWrap = el('div', { class: 'g-cz-contrast', 'data-cz-contrast': '' });
      const contrastPairs = [
        ['Foreground on Background', () => [getCtlHex(colorCtls, 'foreground'), getCtlHex(colorCtls, 'background')]],
        ['Primary fg on Primary', () => [getCtlHex(colorCtls, 'primary-foreground'), getCtlHex(colorCtls, 'primary')]],
        ['Muted fg on Background', () => [getCtlHex(colorCtls, 'muted-foreground'), getCtlHex(colorCtls, 'background')]],
      ];
      function getCtlHex(list, token) { const c = list.find((x) => x.token === token); return c ? c.getHex() : null; }
      updateContrast = () => {
        contrastWrap.textContent = '';
        contrastPairs.forEach(([label, getter]) => {
          const [a, b] = getter();
          const ratio = (a && b) ? czContrastRatio(a, b) : null;
          const passAA = ratio != null && ratio >= 4.5;
          const passAAA = ratio != null && ratio >= 7;
          const row = el('div', { class: 'g-cz-contrast-row' }, [
            el('span', { class: 'g-cz-contrast-lbl', text: label }),
            el('span', { class: 'g-cz-contrast-ratio', text: ratio != null ? ratio.toFixed(2) + ':1' : '—' }),
            el('span', { class: 'g-cz-badge ' + (passAA ? 'is-pass' : 'is-fail'), text: passAA ? 'AA' : 'AA✗' }),
            el('span', { class: 'g-cz-badge ' + (passAAA ? 'is-pass' : 'is-fail'), text: passAAA ? 'AAA' : 'AAA✗' }),
          ]);
          contrastWrap.appendChild(row);
        });
      };

      /* ═══════════════════════════ export panel ═════════════════════════ */
      const exportBar = el('div', { class: 'g-cz-cluster' });
      const downloadBtn = el('button', { type: 'button', class: 'g-cz-btn g-cz-btn--primary', text: 'Download theme.css', 'data-cz-download': '' });
      const copyBtn = el('button', { type: 'button', class: 'g-cz-btn', text: 'Copy CSS', 'data-cz-copy': '' });
      const shareBtn = el('button', { type: 'button', class: 'g-cz-btn', text: 'Copy share link', 'data-cz-share': '' });
      const copyNote = el('span', { class: 'g-cz-note' });
      downloadBtn.addEventListener('click', () => {
        const css = exportThemeCss(scope, CZ_EXPORT_TOKENS, ':root');
        const blob = new Blob([css], { type: 'text/css' });
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: 'theme.css' });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      copyBtn.addEventListener('click', async () => {
        const css = exportThemeCss(scope, CZ_EXPORT_TOKENS, ':root');
        try { await navigator.clipboard.writeText(css); copyNote.textContent = 'Copied!'; }
        catch (_) { code.select(); copyNote.textContent = 'Selected — press Ctrl/Cmd+C'; }
        setTimeout(() => { copyNote.textContent = ''; }, 2000);
      });
      shareBtn.addEventListener('click', async () => {
        const link = location.origin + location.pathname + buildShareHash();
        try { await navigator.clipboard.writeText(link); copyNote.textContent = 'Link copied!'; }
        catch (_) { copyNote.textContent = 'Link in URL bar'; }
        setTimeout(() => { copyNote.textContent = ''; }, 2000);
      });
      exportBar.appendChild(downloadBtn);
      exportBar.appendChild(copyBtn);
      exportBar.appendChild(shareBtn);
      exportBar.appendChild(copyNote);

      const exportPanel = el('div', { class: 'g-cz-panel g-cz-exportpanel' }, [
        el('div', { class: 'g-cz-panel-hd', text: 'Accessibility' }),
        contrastWrap,
        el('div', { class: 'g-cz-panel-hd', style: 'margin-top:1rem', text: 'Export' }),
        exportBar,
        code,
      ]);

      /* ═══════════════════════ share via URL hash ═══════════════════════ */
      // Encode { base, overrides } as base64 JSON in the hash after #customizer.
      function buildShareHash() {
        const payload = { base: currentBase, o: overrides };
        let enc = '';
        try { enc = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))); } catch (_) { enc = ''; }
        return '#customizer?cz=' + enc;
      }
      updateShareUrl = () => {
        // Only rewrite the hash while the customizer route is active.
        if ((location.hash || '').indexOf('customizer') === -1) return;
        try { history.replaceState(null, '', buildShareHash()); } catch (_) { /* ignore */ }
      };
      function restoreFromHash() {
        const h = location.hash || '';
        const m = h.match(/cz=([^&]+)/);
        if (!m) return false;
        let payload;
        try { payload = JSON.parse(decodeURIComponent(escape(atob(m[1])))); } catch (_) { return false; }
        if (!payload) return false;
        suspendShare = true;
        if (payload.base) { currentBase = payload.base; setTheme(payload.base, scope); baseSeg.setActive(payload.base); }
        if (payload.o && typeof payload.o === 'object') {
          applyTheme(scope, payload.o);
          for (const k in payload.o) setOverride(k, payload.o[k]);
        }
        suspendShare = false;
        refreshExport();
        return true;
      }

      wrap.appendChild(controlsCard);
      wrap.appendChild(previewCard);
      wrap.appendChild(exportPanel);
      grid.appendChild(wrap);

      // Mount Grid + Chart now that hosts are attached.
      try {
        new Grid(gridHost, {
          data: genGridRows(8),
          columns: [
            { field: 'id', header: 'ID', type: 'number', width: 56 },
            { field: 'name', header: 'Name', flex: 1, minWidth: 120 },
            { field: 'dept', header: 'Department', flex: 1, minWidth: 110 },
            { field: 'salary', header: 'Salary', type: 'number', width: 100, align: 'end', meta: { format: { grouping: true } } },
          ],
        });
      } catch (e) { console.warn('CUSTOMIZER grid failed:', e && e.message); }
      try {
        new Chart(chartHost, {
          height: 220, type: 'bar', categories: months.slice(),
          series: [
            { name: 'West', data: [12, 18, 9, 14, 20, 16] },
            { name: 'East', data: [8, 11, 15, 10, 13, 19] },
          ],
        });
      } catch (e) { console.warn('CUSTOMIZER chart failed:', e && e.message); }

      // Restore shared state from the hash (if any), then seed export/contrast.
      const restored = restoreFromHash();
      if (!restored) refreshExport();
      else refreshExport();
    },
    { wide: true },
  ),
);

/* ── Buttons ───────────────────────────────────────────────────────────── */
main.appendChild(
  section('buttons', 'Buttons', 'Variants, sizes, icons, loading & disabled states.', (grid) => {
    const variants = [
      ['Primary', { text: 'Primary', variant: 'primary' }],
      ['Secondary', { text: 'Secondary', variant: 'secondary' }],
      ['Destructive', { text: 'Delete', variant: 'destructive', icon: 'trash' }],
      ['Outline', { text: 'Outline', variant: 'outline' }],
      ['Ghost', { text: 'Ghost', variant: 'ghost' }],
      ['Link', { text: 'Link', variant: 'link' }],
    ];
    grid.appendChild(card('Variants', (h) => variants.forEach(([, c]) => new Button(h, c))));
    grid.appendChild(card('Icons & sizes', (h) => {
      new Button(h, { text: 'Search', icon: 'search', iconAlign: 'start' });
      new Button(h, { text: 'Next', icon: 'chevron-right', iconAlign: 'end' });
      new Button(h, { icon: 'plus', variant: 'outline' });
      new Button(h, { text: 'Small', size: 'sm' });
      new Button(h, { text: 'Large', size: 'lg' });
    }));
    grid.appendChild(card('States', (h) => {
      new Button(h, { text: 'Disabled', disabled: true });
      new Button(h, { text: 'Saving', loading: true });
    }));
  }),
);

/* ── Inputs ────────────────────────────────────────────────────────────── */
main.appendChild(
  section('inputs', 'Inputs', 'Text, number, area, choice, sliders, ratings, color & date pickers.', (grid) => {
    grid.appendChild(card('TextField', (h) => {
      new TextField(h, { label: 'Email', value: 'jane@example.com', inputType: 'email', clearable: true });
      new TextField(h, { label: 'Price', prefix: '$', suffix: 'USD', value: '19.99' });
      new TextField(h, { label: 'Email', value: 'nope', error: 'Enter a valid email' });
    }, { block: true }));
    grid.appendChild(card('NumberField', (h) => {
      new NumberField(h, { label: 'Volume', value: '50', min: 0, max: 100, step: 5 });
      new NumberField(h, { label: 'Amount', value: '9.5', precision: 2, prefix: '$' });
    }, { block: true }));
    grid.appendChild(card('TextArea', (h) => {
      new TextArea(h, { label: 'Tweet', maxLength: 280, value: 'Hello world' });
    }, { block: true }));
    grid.appendChild(card('DisplayField & Label', (h) => {
      new DisplayField(h, { label: 'Full name', value: 'Jane Doe' });
      new DisplayField(h, { label: 'Status', value: 'Active', layout: 'inline' });
      new Label(h, { text: 'Password', htmlFor: 'pw', required: true });
    }, { block: true }));
    grid.appendChild(card('Link', (h) => {
      new Link(h, { text: 'Read the docs', href: '#' });
      new Link(h, { text: 'Terms', href: '#', variant: 'underline' });
    }));
    grid.appendChild(card('Select', (h) => {
      new Select(h, { options: colors, placeholder: 'Choose a color', ariaLabel: 'Color', clearable: true });
    }, { block: true }));
    grid.appendChild(card('ComboBox (autocomplete + multi)', (h) => {
      new ComboBox(h, { options: fruits, placeholder: 'Search fruit…', ariaLabel: 'Fruit' });
      new ComboBox(h, { options: fruits, multiple: true, values: ['apple', 'cherry'], placeholder: 'Add fruit…', ariaLabel: 'Fruits' });
    }, { block: true }));
    grid.appendChild(card('Checkbox', (h) => {
      new Checkbox(h, { label: 'Remember me', checked: true });
      new Checkbox(h, { label: 'Select all', indeterminate: true });
    }, { block: true }));
    grid.appendChild(card('CheckboxGroup', (h) => {
      new CheckboxGroup(h, {
        options: [
          { value: 'cheese', label: 'Cheese' },
          { value: 'mushroom', label: 'Mushroom' },
          { value: 'olive', label: 'Olive' },
        ],
        value: ['cheese'], ariaLabel: 'Toppings',
      });
    }, { block: true }));
    grid.appendChild(card('Radio & RadioGroup', (h) => {
      new RadioGroup(h, { options: plans, value: 'pro', ariaLabel: 'Plan' });
    }, { block: true }));
    grid.appendChild(card('Switch', (h) => {
      new Switch(h, { label: 'Notifications', checked: true });
      new Switch(h, { label: 'Airplane mode' });
    }, { block: true }));
    grid.appendChild(card('Slider & RangeSlider', (h) => {
      new Slider(h, { min: 0, max: 100, value: 40, label: 'Volume' });
      new RangeSlider(h, { min: 0, max: 100, value: [25, 75] });
    }, { block: true }));
    grid.appendChild(card('Rating', (h) => {
      new Rating(h, { max: 5, value: 3.5, allowHalf: true });
    }));
    grid.appendChild(card('ColorPicker', (h) => {
      new ColorPicker(h, { value: '#00aeef', alpha: true });
    }));
    grid.appendChild(card('FilePicker', (h) => {
      new FilePicker(h, { hint: 'Images only — drag & drop', accept: 'image/*' });
    }, { block: true }));
    grid.appendChild(card('DatePicker', (h) => {
      new DatePicker(h, { value: new Date(2026, 5, 10) });
    }));
    grid.appendChild(card('TimePicker', (h) => {
      new TimePicker(h, { value: { hours: 9, minutes: 30 }, hour12: true });
    }));
    grid.appendChild(card('DateTimeField', (h) => {
      new DateTimeField(h, { value: new Date(2026, 5, 10, 9, 30) });
    }));
    grid.appendChild(card('MiniCalendar', (h) => {
      new MiniCalendar(h, { value: new Date(2026, 5, 10), viewDate: new Date(2026, 5, 10) });
    }));
    grid.appendChild(card('Avatar, Badge, ProgressBar, Spacer', (h) => {
      new Avatar(h, { name: 'Ada Lovelace' });
      new Badge(h, { text: 'Active', variant: 'success', dot: true });
      new Badge(h, { text: 'Cyan', variant: 'cyan' });
      new Spacer(h, { size: 'md' });
      const pb = el('div', { style: 'flex:1 1 100%' });
      h.appendChild(pb);
      new ProgressBar(pb, { value: 60, showLabel: true });
    }, { block: true }));
  }),
);

/* ── Forms ─────────────────────────────────────────────────────────────── */
main.appendChild(
  section('forms', 'Forms', 'Declarative schema-driven forms with validation rules, fieldsets and grid layout.', (grid) => {
    /* — Enterprise form: 20+ control types, conditional show/hide, dirty
         tracking, async validation, validation modes. — */
    grid.appendChild(card('Form — conditional fields · 20+ controls · dirty tracking · async validation', (h) => {
      const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.5rem;width:100%' });
      const status = el('div', { class: 'g-note', text: 'Pristine — change a field to see dirty tracking.' });
      const host = el('div'); wrap.appendChild(host); wrap.appendChild(status); h.appendChild(wrap);
      const form = new Form(host, {
        ariaLabel: 'Enterprise contact form',
        layout: { cols: 2, fieldsets: [
          { legend: 'Contact', group: 'contact' },
          { legend: 'Preferences', group: 'prefs' },
        ] },
        validateOn: 'blur',
        fields: [
          { name: 'name', control: 'text', label: 'Name', group: 'contact', rules: { required: true } },
          { name: 'email', control: 'email', label: 'Email', group: 'contact', rules: { required: true, email: true } },
          { name: 'password', control: 'password', label: 'Password', group: 'contact', rules: { required: true, minLength: 8 } },
          { name: 'website', control: 'url', label: 'Website', group: 'contact' },
          // Conditional field: phone only shows when "contact by phone" is on.
          { name: 'byPhone', control: 'switch', label: 'Prefer phone contact', group: 'prefs' },
          { name: 'phone', control: 'text', label: 'Phone', group: 'prefs',
            showWhen: (v) => !!v.byPhone, rules: { required: true, pattern: '^[0-9 +()-]{7,}$' } },
          { name: 'satisfaction', control: 'rating', label: 'Satisfaction', group: 'prefs', props: { max: 5 } },
          { name: 'budget', control: 'slider', label: 'Budget', group: 'prefs', props: { min: 0, max: 100, value: 40 } },
          { name: 'when', control: 'datetime', label: 'Best time', group: 'prefs' },
          { name: 'topics', control: 'checkboxgroup', label: 'Topics', group: 'prefs', props: { options: [
            { value: 'sales', label: 'Sales' }, { value: 'support', label: 'Support' }, { value: 'press', label: 'Press' },
          ] } },
          { name: 'tags', control: 'tags', label: 'Tags', group: 'prefs' },
          { name: 'role', control: 'select', label: 'Role', group: 'prefs', props: { options: [
            { value: 'eng', label: 'Engineer' }, { value: 'design', label: 'Designer' }, { value: 'pm', label: 'Product' },
          ] } },
        ],
        submitText: 'Send', resetText: 'Clear',
      });
      const refresh = () => {
        try {
          status.textContent = form.isDirty()
            ? `Dirty — changed: ${Object.keys(form.getDirtyValues()).join(', ') || '—'}`
            : 'Pristine — change a field to see dirty tracking.';
        } catch (e) { console.warn('FORM-DEMO feature failed:', e && e.message); }
      };
      try { form.on('change', refresh); form.on('dirty', refresh); } catch (e) { console.warn('FORM-DEMO feature failed:', e && e.message); }
    }, { block: true }));
    grid.appendChild(card('Two-column grid', (h) => {
      new Form(h, {
        ariaLabel: 'Profile form',
        layout: { cols: 2 },
        fields: [
          { name: 'first', control: 'text', label: 'First name', rules: { required: true } },
          { name: 'last', control: 'text', label: 'Last name', rules: { required: true } },
          { name: 'bio', control: 'textarea', label: 'Bio', colSpan: 2 },
          { name: 'age', control: 'number', label: 'Age', rules: { numeric: true, min: 18, max: 120 } },
          { name: 'role', control: 'select', label: 'Role', props: { options: [
            { value: 'eng', label: 'Engineer' }, { value: 'design', label: 'Designer' }, { value: 'pm', label: 'Product' },
          ] } },
        ],
      });
    }, { block: true }));
  }, { wide: true }),
);

/* ── Layout ────────────────────────────────────────────────────────────── */
const cell = (label) => `<div style="padding:1rem">${label}</div>`;
const pane = (label) => `<div style="padding:1rem;height:100%;box-sizing:border-box">${label}</div>`;
main.appendChild(
  section('layout', 'Layout', 'Border layout, splitters, panels and flex/grid containers.', (grid) => {
    grid.appendChild(card('Layout (border regions)', (h) => {
      const host = el('div', { class: 'g-host-layout' });
      h.appendChild(host);
      new Layout(host, {
        north: { content: cell('Header'), size: 0.2 },
        west: { content: cell('Sidebar'), size: 0.25, collapsible: true },
        center: { content: cell('Main content') },
      });
    }, { block: true }));
    grid.appendChild(card('Splitter (drag the bar)', (h) => {
      const host = el('div', { class: 'g-host-splitter' });
      h.appendChild(host);
      new Splitter(host, { orientation: 'horizontal', first: pane('Left'), second: pane('Right') });
    }, { block: true }));
    grid.appendChild(card('Panel (collapsible)', (h) => {
      new Panel(h, { title: 'Settings', collapsible: true, body: '<p>Click the header to collapse.</p>', footer: '<span>Saved 2 minutes ago</span>' });
    }, { block: true }));
    grid.appendChild(card('Container (flex / grid)', (h) => {
      new Container(h, {
        role: 'toolbar', ariaLabel: 'Actions', gap: 2, align: 'center',
        items: [
          { type: 'button', text: 'Save', variant: 'primary' },
          { type: 'button', text: 'Cancel', variant: 'ghost' },
        ],
      });
    }, { block: true }));
  }),
);

/* ── Navigation ────────────────────────────────────────────────────────── */
main.appendChild(
  section('navigation', 'Navigation', 'Toolbar, menu, context menu, sidebar, ribbon, tabs and pagination.', (grid) => {
    grid.appendChild(card('Toolbar', (h) => {
      new Toolbar(h, { items: [
        { id: 'new', text: 'New', icon: 'plus', variant: 'primary' },
        { id: 'edit', text: 'Edit', icon: 'edit' },
        { separator: true },
        { id: 'delete', text: 'Delete', icon: 'trash', variant: 'ghost' },
      ] });
    }, { block: true }));
    grid.appendChild(card('Menu (submenus + checkable)', (h) => {
      new Menu(h, { items: [
        { id: 'new', text: 'New', icon: 'plus', shortcut: 'Ctrl+N' },
        { id: 'open', text: 'Open Recent', children: [
          { id: 'r1', text: 'project-a' }, { id: 'r2', text: 'project-b' },
        ] },
        { separator: true },
        { id: 'wrap', text: 'Word Wrap', checkable: true, checked: true },
      ] });
    }, { block: true }));
    grid.appendChild(card('ContextMenu (right-click box)', (h) => {
      const target = el('div', { text: 'Right-click inside this box',
        style: 'padding:2rem;border:1px dashed currentColor;border-radius:8px;text-align:center;width:100%' });
      h.appendChild(target);
      new ContextMenu(h, { target, items: [
        { id: 'cut', text: 'Cut' }, { id: 'copy', text: 'Copy' }, { id: 'paste', text: 'Paste' },
        { separator: true }, { id: 'del', text: 'Delete', icon: 'trash' },
      ] });
    }, { block: true }));
    grid.appendChild(card('Sidebar', (h) => {
      const host = el('div', { class: 'g-host-sidebar' });
      h.appendChild(host);
      new Sidebar(host, {
        title: 'Acme', active: 'dashboard', expanded: ['content'],
        items: [
          { id: 'dashboard', text: 'Dashboard', icon: 'menu' },
          { id: 'content', text: 'Content', icon: 'edit', children: [
            { id: 'posts', text: 'Posts' }, { id: 'pages', text: 'Pages' },
          ] },
          { id: 'inbox', text: 'Inbox', icon: 'info', badge: '5' },
          { id: 'settings', text: 'Settings', icon: 'filter' },
        ],
      });
    }, { block: true }));
    grid.appendChild(card('Ribbon', (h) => {
      new Ribbon(h, { tabs: [
        { id: 'home', text: 'Home', groups: [
          { title: 'Clipboard', commands: [
            { id: 'paste', text: 'Paste', icon: 'plus' },
            { id: 'cut', icon: 'minus', label: 'Cut' },
            { id: 'copy', icon: 'check', label: 'Copy' },
          ] },
          { title: 'Editing', commands: [
            { id: 'find', icon: 'search', label: 'Find' },
            { id: 'filter', icon: 'filter', label: 'Filter' },
          ] },
        ] },
        { id: 'insert', text: 'Insert', groups: [
          { title: 'Media', commands: [{ id: 'image', text: 'Image', icon: 'edit' }] },
        ] },
      ] });
    }, { block: true }));
    grid.appendChild(card('Tabbar', (h) => {
      new Tabbar(h, { ariaLabel: 'Sections', active: 'overview', items: [
        { id: 'overview', label: 'Overview' }, { id: 'specs', label: 'Specs' }, { id: 'reviews', label: 'Reviews' },
      ] });
    }, { block: true }));
    grid.appendChild(card('TabPanel', (h) => {
      new TabPanel(h, { ariaLabel: 'Account', items: [
        { id: 'profile', label: 'Profile', content: '<p>Your profile details.</p>' },
        { id: 'billing', label: 'Billing', content: '<p>Manage your subscription.</p>' },
        { id: 'team', label: 'Team', content: '<p>Invite teammates here.</p>' },
      ] });
    }, { block: true }));
    grid.appendChild(card('Pagination', (h) => {
      new Pagination(h, { total: 240, pageSize: 20, page: 3, pageSizeOptions: [10, 20, 50, 100] });
    }, { block: true }));
  }),
);

/* ── Overlays & Feedback ───────────────────────────────────────────────── */
main.appendChild(
  section('overlays', 'Overlays & Feedback', 'Tooltips, popups, masks, floating windows, dialogs and toasts. Use the buttons to launch the transient overlays.', (grid) => {
    grid.appendChild(card('Tooltip', (h) => {
      const target = new Button(h, { text: 'Hover me', variant: 'secondary' });
      new Tooltip(h, { target: target.el, text: 'Tooltip on top', placement: 'top', showDelay: 100 });
    }));
    grid.appendChild(card('Popup (click to anchor)', (h) => {
      const anchor = new Button(h, { text: 'Open popup', variant: 'outline' });
      const popup = new Popup(h, {
        anchor: anchor.el, placement: 'bottom', align: 'start',
        html: '<strong>Menu</strong><ul style="margin:.4rem 0 0;padding-left:1.1rem"><li>One</li><li>Two</li></ul>',
      });
      anchor.el.addEventListener('click', () => popup.toggle());
    }));
    grid.appendChild(card('Mask (overlay spinner)', (h) => {
      const box = el('div', { style: 'position:relative;width:100%;height:120px;border:1px solid oklch(var(--jects-border));border-radius:8px' });
      h.appendChild(box);
      h.appendChild(triggerBtn('Show mask 1.5s', () => {
        const m = new Mask(box, { message: 'Loading…' });
        setTimeout(() => m.destroy(), 1500);
      }));
    }, { block: true }));
    grid.appendChild(card('Window (floating, draggable)', (h) => {
      h.appendChild(triggerBtn('Open window', () => {
        new Window(document.body, {
          title: 'Untitled', x: 120, y: 120, width: 380,
          text: 'A draggable, resizable floating panel. Drag the header to move it.',
          minimizable: true,
        });
      }, 'primary'));
    }));
    grid.appendChild(card('Dialog (modal, promise)', (h) => {
      h.appendChild(triggerBtn('Open dialog', async () => {
        const d = new Dialog(document.body, {
          title: 'Delete file?', text: 'This action cannot be undone.', tone: 'destructive',
          actions: [
            { key: 'cancel', text: 'Cancel', variant: 'outline' },
            { key: 'delete', text: 'Delete', variant: 'destructive', autoFocus: true },
          ],
        });
        await d.open();
      }, 'destructive'));
    }));
    grid.appendChild(card('MessageManager — Toasts', (h) => {
      const mm = new MessageManager(document.body, { position: 'top-right' });
      h.appendChild(triggerBtn('Info toast', () =>
        mm.push({ title: 'Heads up', message: 'A new version is available.', variant: 'info' })));
      h.appendChild(triggerBtn('Success toast', () =>
        mm.push({ title: 'Saved', message: 'Your changes are live.', variant: 'success' })));
      h.appendChild(triggerBtn('Error toast', () =>
        mm.push({ title: 'Upload failed', message: 'Check your connection.', variant: 'error' })));
    }, { block: true }));
    grid.appendChild(card('Imperative alert / confirm / prompt', (h) => {
      h.appendChild(triggerBtn('alert()', () => alert({ title: 'Notice', message: 'Operation completed.', variant: 'success' })));
      h.appendChild(triggerBtn('confirm()', () => confirm({ title: 'Delete item?', message: 'This cannot be undone.', variant: 'error', okText: 'Delete' })));
      h.appendChild(triggerBtn('prompt()', () => prompt({ title: 'Rename', message: 'Enter a new name', defaultValue: 'untitled' })));
    }, { block: true }));
  }),
);

/* ── Rich Text ─────────────────────────────────────────────────────────── */
main.appendChild(
  section('richtext', 'Rich Text', 'WYSIWYG editor with a configurable toolbar.', (grid) => {
    /* — RichText: full editor — images, tables, color, font, indent,
         source view, markdown export, paste-clean. — */
    grid.appendChild(card('RichText — images · tables · color · fonts · source view · markdown', (h) => {
      const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.5rem;width:100%' });
      const editorHost = el('div'); wrap.appendChild(editorHost);
      const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.4rem;align-items:center' });
      wrap.appendChild(bar); h.appendChild(wrap);
      const rt = new RichText(editorHost, {
        // Full toolbar incl. the new items.
        toolbar: [
          'bold', 'italic', 'underline', 'strike', 'separator',
          'h1', 'h2', 'paragraph', 'separator',
          'fontFamily', 'fontSize', 'foreColor', 'backColor', 'separator',
          'ul', 'ol', 'indent', 'outdent', 'blockquote', 'code', 'separator',
          'link', 'insertImage', 'insertTable', 'separator',
          'alignLeft', 'alignCenter', 'alignRight', 'separator',
          'sourceView', 'undo', 'redo', 'clear',
        ],
        pasteClean: true,
        value: '<h2>Quarterly report</h2>'
          + '<p>Edit this <strong>rich</strong> <em>content</em> — try the <span style="color:#0ea5e9">color</span>, font, image and table tools.</p>'
          + '<table><thead><tr><th>Region</th><th>Revenue</th></tr></thead>'
          + '<tbody><tr><td>West</td><td>$24,600</td></tr><tr><td>East</td><td>$18,200</td></tr></tbody></table>'
          + '<ul><li>Bullet one</li><li>Bullet two</li></ul>',
      });
      const mdBtn = el('button', { class: 'jects-btn jects-btn--sm', text: 'Export Markdown' });
      const mdOut = el('pre', { style: 'display:none;max-height:120px;overflow:auto;background:oklch(var(--jects-muted));padding:.5rem;border-radius:var(--jects-radius-sm);font-size:11px;white-space:pre-wrap' });
      mdBtn.addEventListener('click', () => {
        try { mdOut.textContent = rt.getMarkdown(); mdOut.style.display = 'block'; }
        catch (e) { console.warn('RT-DEMO feature failed:', e && e.message); }
      });
      bar.appendChild(mdBtn); wrap.appendChild(mdOut);
    }, { block: true }));
  }, { wide: true }),
);

/* ── Data Grid ─────────────────────────────────────────────────────────── */
main.appendChild(
  section('grid', 'Data Grid', 'Virtualized grid with sortable / filterable columns, inline editing, selection, and tree mode.', (grid) => {
    const firsts = ['Ada', 'Alan', 'Grace', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Ken'];
    const lasts = ['Lovelace', 'Turing', 'Hopper', 'Torvalds', 'Hamilton', 'Ritchie', 'Liskov', 'Thompson'];
    const depts = ['Engineering', 'Design', 'Product', 'Research'];
    const rows = Array.from({ length: 500 }, (_, i) => ({
      id: i + 1,
      name: `${firsts[i % firsts.length]} ${lasts[(i * 3) % lasts.length]}`,
      dept: depts[i % depts.length],
      salary: 60000 + ((i * 1234) % 90000),
      active: i % 3 !== 0,
    }));

    grid.appendChild(card('Enterprise grid — full featureset (selection · grouping · summaries · export · undo · master-detail · responsive · state)', (h) => {
      const warn = (label, e) => console.warn('GRID-DEMO feature failed:', label, e && e.message);

      // Enrich the 500 base rows with the extra typed-column fields this demo
      // exercises (hire date, rating, edits). Keeps the upstream `rows` intact.
      const DAY_MS = 24 * 60 * 60 * 1000;
      const grades = ['L3', 'L4', 'L5', 'L6'];
      const erows = rows.map((r, i) => ({
        ...r,
        grade: grades[i % grades.length],
        hired: new Date(Date.UTC(2015 + (i % 9), i % 12, 1 + (i % 27))),
        rating: 1 + (i % 5),
        bonus: 2000 + ((i * 311) % 12000),
        note: `${r.name} — ${r.dept} (${grades[i % grades.length]})`,
      }));

      const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.5rem;width:100%' });
      const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.4rem;flex-wrap:wrap;align-items:center' });
      const host = el('div', { class: 'g-host-grid' });
      const statusEl = el('div', { class: 'g-note', style: 'min-height:1.2em' });
      wrap.appendChild(bar);
      wrap.appendChild(host);
      wrap.appendChild(statusEl);
      h.appendChild(wrap);
      const setStatus = (m) => { statusEl.textContent = m; };
      const money = (v) => (v == null ? '' : '$' + Number(v).toLocaleString('en-US'));

      // Master-detail handle — assigned from `rowExpanderFeature` below. The
      // leading expander column's renderer closes over it (evaluated lazily at
      // paint, after install). We host the toggle ourselves (`column:false` on
      // the feature) so the expander column never collides with the action column.
      let expander;

      // Typed columns declared purely by `type` — the engine's default body
      // painter resolves number/date/rating/check/action renderers from the
      // typed-renderer registry (no explicit `renderer:` needed). `meta.format`
      // tunes the number formatter; `meta.rating`/`meta.actions` feed the rating
      // and action renderers. `responsivePriority` drives responsive auto-hide
      // (lowest priority drops first); `frozen` pins edge columns; header `group`
      // strings drive the multi-level stacked header; `tooltip` feeds tooltipFeature.
      const grid2 = new Grid(host, {
        data: erows,
        selection: 'multi',
        editing: { enabled: true, trigger: 'dblclick' },
        features: {
          sort: { multi: true },
          filter: true,
          columnResize: true,
          columnReorder: true,
          clipboard: true,
          selectionColumn: { headerCheckbox: true },
          // Responsive auto-hide via explicit breakpoints: as the grid narrows,
          // hide the lower-value Grade then Bonus columns. (Breakpoints mode only
          // toggles `hidden` — unlike priority mode it never reorders columns, so
          // data-col-index stays sequential alongside the other features here.)
          responsive: {
            breakpoints: [
              { maxWidth: 820, hide: ['grade'] },
              { maxWidth: 680, hide: ['grade', 'bonus'] },
            ],
          },
          group: {
            aggregations: { salary: 'sum', bonus: 'avg', rating: 'avg', id: 'count' },
            footerAggregations: { salary: 'sum', bonus: 'avg', rating: 'avg', id: 'count' },
          },
        },
        columns: [
          // Master-detail expander toggle (custom template column; the feature
          // runs with `column:false` so this is the only expander affordance).
          { id: '__expander', header: '', type: 'template', width: 40, align: 'center', frozen: 'left', responsivePriority: 120,
            renderer: (ctx) => {
              const open = expander && expander.isExpanded && expander.isExpanded(ctx.row.id);
              const b = el('button', { class: 'jects-grid__tree-toggle', 'aria-label': open ? 'Collapse detail' : 'Expand detail' });
              b.type = 'button';
              b.dataset.expanderToggle = '';
              b.textContent = open ? '▾' : '▸';
              b.addEventListener('click', (e) => { e.stopPropagation(); try { expander && expander.toggle(ctx.row.id); } catch (_) {} });
              ctx.el.replaceChildren(b);
            } },
          { field: 'id', header: 'ID', type: 'number', width: 64, sortable: true, frozen: 'left', responsivePriority: 100 },
          { field: 'name', header: 'Name', group: 'Person', flex: 1, minWidth: 130, sortable: true, filterable: true, frozen: 'left', responsivePriority: 90,
            tooltip: (ctx) => `Employee #${ctx.row.id}: ${ctx.value}` },
          { field: 'dept', header: 'Department', group: 'Person', flex: 1, minWidth: 120, sortable: true, filterable: true, responsivePriority: 80 },
          { field: 'grade', header: 'Grade', group: 'Person', width: 80, sortable: true, filterable: true, responsivePriority: 20 },
          { field: 'salary', header: 'Salary', group: 'Compensation', type: 'number', width: 110, align: 'end', sortable: true, filterable: true, responsivePriority: 70,
            meta: { format: { grouping: true } } },
          { field: 'bonus', header: 'Bonus', group: 'Compensation', type: 'number', width: 100, align: 'end', sortable: true, responsivePriority: 30,
            meta: { format: { grouping: true } } },
          { field: 'hired', header: 'Hired', group: 'Record', type: 'date', width: 120, sortable: true, responsivePriority: 40 },
          { field: 'rating', header: 'Rating', group: 'Record', type: 'rating', width: 120, align: 'center', sortable: true, responsivePriority: 50, meta: { rating: { max: 5 } } },
          { field: 'active', header: 'Active', group: 'Record', type: 'check', width: 80, align: 'center', responsivePriority: 60 },
          { header: 'Actions', type: 'action', width: 96, align: 'center', responsivePriority: 110,
            meta: { actions: [
              { key: 'star', label: 'Rate', onClick: (ctx) => { try { ctx.api.store.update(ctx.row.id, { rating: 5 }); setStatus('Set rating to 5 for ' + ctx.row.name); } catch (_) {} } },
              { key: 'toggle', label: 'Toggle', onClick: (ctx) => { try { ctx.api.store.update(ctx.row.id, { active: !ctx.row.active }); setStatus('Toggled active for ' + ctx.row.name); } catch (_) {} } },
            ] } },
        ],
      });

      // Features that aren't config-auto-registered are installed explicitly via
      // grid.use(...). Each is wrapped so a failure surfaces as a console warning
      // rather than killing the whole card.
      let summary, picker, state, fmenu, undo, rowEdit;
      try { grid2.use(headerGroupsFeature()); } catch (e) { warn('headerGroups', e); }
      try {
        summary = grid2.use(summaryFeature({
          label: 'Totals',
          aggregations: { salary: 'sum', bonus: 'avg', rating: 'avg', id: 'count' },
          format: (v, id) => (id === 'salary' || id === 'bonus') ? money(v) : (v == null ? '' : (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : String(v))),
        }));
      } catch (e) { warn('summary', e); }
      try { rowEdit = grid2.use(editingFeature({ rowEdit: true, trigger: 'manual' })); } catch (e) { warn('editing(rowEdit)', e); }
      try { state = grid2.use(columnStateFeature({ storageKey: 'jects-gallery-grid-state' })); } catch (e) { warn('columnState', e); }
      try { picker = grid2.use(columnPickerFeature({ title: 'Columns' })); } catch (e) { warn('columnPicker', e); }
      try { grid2.use(filterBarFeature()); } catch (e) { warn('filterBar', e); }
      try { fmenu = grid2.use(filterMenuFeature()); } catch (e) { warn('filterMenu', e); }
      try { grid2.use(filterFacetFeature()); } catch (e) { warn('filterFacet', e); }
      try { undo = grid2.use(undoRedoFeature()); } catch (e) { warn('undoRedo', e); }
      try { grid2.use(fillFeature()); } catch (e) { warn('fill', e); }
      try {
        grid2.use(tooltipFeature({ showOnOverflow: true }));
      } catch (e) { warn('tooltip', e); }
      // Master-detail / row expander: when a row is expanded (via the leading
      // expander column), a full-width detail row is injected beneath it. Run
      // with `column:false` so we host the toggle ourselves — this avoids the
      // auto-prepended expander column colliding with the action column. Coexists
      // with the selection column; data-col-index stays sequential.
      try {
        expander = grid2.use(rowExpanderFeature({
          column: false,
          detailHeight: 96,
          renderer: (ctx) => {
            const d = el('div', { class: 'g-grid-detail', style: 'display:flex;flex-direction:column;gap:.25rem;padding:.5rem .75rem;font-size:.85em;line-height:1.5' });
            d.appendChild(el('div', { html: `<strong>${ctx.row.name}</strong> &middot; ${ctx.row.dept} &middot; grade ${ctx.row.grade}` }));
            d.appendChild(el('div', { text: `Salary ${money(ctx.row.salary)} · bonus ${money(ctx.row.bonus)} · rating ${ctx.row.rating}/5 · ${ctx.row.active ? 'active' : 'inactive'}` }));
            d.appendChild(el('div', { text: `Hired ${new Date(ctx.row.hired).toISOString().slice(0, 10)}` }));
            return d;
          },
        }));
        grid2.refresh();
      } catch (e) { warn('rowExpander', e); }
      // Export features (CSV/Excel from exportFeature, PDF from pdfExportFeature).
      let exporter, pdf;
      try { exporter = grid2.features.get('export') || grid2.use(exportFeature({ fileName: 'employees' })); } catch (e) { warn('export', e); }
      try { pdf = grid2.use(pdfExportFeature({ fileName: 'employees', title: 'Employees' })); } catch (e) { warn('pdfExport', e); }

      /* ── Interactive toolbar ──────────────────────────────────────────── */
      const tb = (text, onClick, variant = 'secondary') => {
        const b = new Button(bar, { text, variant, size: 'sm' });
        b.el.addEventListener('click', (e) => { try { onClick(e); } catch (err) { warn('toolbar:' + text, err); } });
        return b;
      };

      // Grouping toggle (Department).
      let grouped = false;
      tb('Group by dept', () => {
        const gf = grid2.features.get('group');
        if (!gf) return;
        grouped = !grouped;
        gf.setGroups(grouped ? ['dept'] : []);
        setStatus(grouped ? 'Grouped by Department (per-group + footer aggregates).' : 'Ungrouped.');
      }, 'outline');

      tb('Columns…', () => { if (picker && picker.toggle) picker.toggle(120, 120); setStatus('Toggled column picker.'); }, 'outline');
      tb('Filter menu', () => { if (fmenu && fmenu.openFor) fmenu.openFor('salary', 160, 140); setStatus('Opened filter operator menu for Salary.'); }, 'outline');
      tb('Row edit', () => { if (rowEdit && rowEdit.start) { rowEdit.start({ rowIndex: 0, colIndex: 2 }); setStatus('Started row edit on first row.'); } }, 'outline');

      // Master-detail: expand/collapse all rows from the toolbar.
      let allExpanded = false;
      tb('Expand all', (e) => {
        if (!expander) return;
        allExpanded = !allExpanded;
        if (allExpanded) { expander.expandAll && expander.expandAll(); }
        else { expander.collapseAll && expander.collapseAll(); }
        e.currentTarget?.setAttribute?.('aria-pressed', String(allExpanded));
        setStatus(allExpanded ? 'Expanded all detail rows.' : 'Collapsed all detail rows.');
      }, 'outline');

      // Export formats collapsed into one accessible "Export ▾" menu.
      exportMenu(bar, [
        { label: 'CSV', onClick: () => { if (exporter && exporter.downloadCsv) exporter.downloadCsv(); setStatus('Exported CSV.'); } },
        { label: 'Excel', onClick: () => { if (exporter && exporter.downloadExcel) exporter.downloadExcel(); setStatus('Exported Excel (.xls).'); } },
        { label: 'PDF', onClick: () => { if (pdf && pdf.downloadPdf) pdf.downloadPdf(); setStatus('Exported PDF.'); } },
      ]);

      tb('Save state', () => { if (state && state.persistNow) state.persistNow(); setStatus('Saved column/sort/filter/group state.'); });
      tb('Restore state', () => {
        if (state && state.getState && state.applyState) { state.applyState(state.getState()); setStatus('Restored persisted state.'); }
      });
      tb('Undo', () => { if (undo && undo.undo) undo.undo(); setStatus('Undo.'); });
      tb('Redo', () => { if (undo && undo.redo) undo.redo(); setStatus('Redo.'); });

      // ── Enterprise scale: swap to a virtualized 100,000-row dataset on demand. ──
      enterpriseSwap(bar, host, {
        key: 'grid',
        count: '100,000 rows',
        status: setStatus,
        build: (bigHost) => {
          const big = genGridRows(100_000);
          new Grid(bigHost, {
            data: big,
            selection: 'multi',
            features: {
              sort: { multi: true },
              filter: true,
              columnResize: true,
              columnReorder: true,
              clipboard: true,
              selectionColumn: { headerCheckbox: true },
            },
            columns: [
              { field: 'id', header: 'ID', type: 'number', width: 80, sortable: true, frozen: 'left' },
              { field: 'name', header: 'Name', flex: 1, minWidth: 170, sortable: true, filterable: true, frozen: 'left' },
              { field: 'dept', header: 'Department', width: 150, sortable: true, filterable: true },
              { field: 'status', header: 'Status', width: 120, sortable: true, filterable: true },
              { field: 'salary', header: 'Salary ($)', type: 'number', width: 120, align: 'end', sortable: true, filterable: true, meta: { format: { grouping: true } } },
              { field: 'hired', header: 'Hired', type: 'date', width: 130, sortable: true },
              { field: 'progress', header: 'Progress %', type: 'number', width: 120, align: 'end', sortable: true, meta: { format: { grouping: false } } },
            ],
          });
        },
      });

      h.appendChild(el('div', { class: 'g-note', text: 'Typed columns by type (number/text/date/rating/check/action) with frozen left columns and a multi-level (grouped) header. Checkbox selection, range copy/paste + fill handle, multi-sort, filter bar + operator menu + faceted filter, grouping with per-group & footer aggregates, cell + row editing, master-detail row expander (click the ▸ to open a detail row), cell tooltips, column-state persistence, undo/redo, responsive column auto-hide, and CSV/Excel/PDF export — driven from the toolbar above. The engine virtualizes 50k+ rows — only visible rows are in the DOM.' }));
    }, { block: true }));

    grid.appendChild(card('Tree mode (hierarchical rows)', (h) => {
      const host = el('div', { class: 'g-host-grid' });
      h.appendChild(host);
      const treeRows = [
        { id: 'eng', name: 'Engineering', count: 42, children: [
          { id: 'fe', name: 'Frontend', count: 18, children: [
            { id: 'fe-a', name: 'Web Platform', count: 9 },
            { id: 'fe-b', name: 'Design Systems', count: 9 },
          ] },
          { id: 'be', name: 'Backend', count: 24 },
        ] },
        { id: 'design', name: 'Design', count: 12, children: [
          { id: 'ux', name: 'UX', count: 7 },
          { id: 'brand', name: 'Brand', count: 5 },
        ] },
      ];
      new Grid(host, {
        data: new TreeStore({ data: treeRows }),
        treeMode: true,
        columns: [
          { field: 'name', header: 'Team', type: 'tree', flex: 1 },
          { field: 'count', header: 'Headcount', type: 'number', width: 130, align: 'end' },
        ],
      });
    }, { block: true }));
  }, { wide: true }),
);

/* ── Charts ────────────────────────────────────────────────────────────── */
main.appendChild(
  section('charts', 'Charts', 'Thirteen chart types rendered with the house CMYK data ramp (data-1 … data-8), plus interactive zoom/pan/crosshair, numeric & bubble axes, gradients, a live streaming feed, and PDF export.', (grid) => {
    const chartHost = () => el('div', { class: 'g-host-chart' });
    const make = (label, config) => card(label, (h) => {
      const host = chartHost();
      h.appendChild(host);
      new Chart(host, { height: 260, ...config });
    }, { block: true });

    grid.appendChild(make('Line', { type: 'line', categories: months, series: [
      { name: 'Revenue', data: [12, 19, 15, 22, 18, 25] }, { name: 'Cost', data: [8, 11, 9, 13, 12, 15] },
    ] }));
    grid.appendChild(make('Spline', { type: 'spline', categories: months, series: [{ name: 'Sessions', data: [30, 45, 38, 60, 52, 70] }] }));
    grid.appendChild(make('Bar', { type: 'bar', categories: months, series: [
      { name: 'A', data: [5, 8, 6, 9, 7, 10] }, { name: 'B', data: [3, 5, 4, 6, 5, 7] },
    ] }));
    grid.appendChild(make('Stacked bar', { type: 'bar', stacked: true, categories: months, series: [
      { name: 'Online', data: [5, 8, 6, 9, 7, 10] }, { name: 'Retail', data: [3, 5, 4, 6, 5, 7] },
    ] }));
    grid.appendChild(make('Horizontal bar', { type: 'horizontalBar', categories: ['North', 'South', 'East', 'West'], series: [{ name: 'Units', data: [40, 25, 33, 18] }] }));
    grid.appendChild(make('Area', { type: 'area', categories: months, series: [{ name: 'Traffic', data: [10, 22, 18, 30, 26, 35] }] }));
    grid.appendChild(make('Spline area', { type: 'splineArea', categories: months, series: [{ name: 'Load', data: [10, 22, 18, 30, 26, 35] }] }));
    grid.appendChild(make('Pie', { type: 'pie', categories: ['Cyan', 'Magenta', 'Yellow', 'Key'], data: [30, 25, 20, 25] }));
    grid.appendChild(make('Donut', { type: 'donut', categories: ['Cyan', 'Magenta', 'Yellow', 'Key'], data: [30, 25, 20, 25], innerRadius: 0.62 }));
    grid.appendChild(make('Radar', { type: 'radar', categories: ['Speed', 'Power', 'Range', 'Agility', 'Defense'], series: [
      { name: 'Alpha', data: [80, 65, 70, 90, 60] }, { name: 'Beta', data: [60, 80, 85, 55, 75] },
    ] }));
    grid.appendChild(make('Scatter', { type: 'scatter', categories: months, series: [{ name: 'Points', data: [12, 5, 18, 9, 22, 14] }] }));
    grid.appendChild(make('Treemap', { type: 'treemap', categories: ['Search', 'Social', 'Direct', 'Email', 'Referral'], data: [50, 30, 20, 12, 8] }));
    grid.appendChild(make('Heatmap', { type: 'heatmap', categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], series: [
      { name: 'wk', data: [], matrix: [[1, 3, 2, 5, 4], [2, 4, 6, 3, 1], [5, 2, 3, 4, 6]] },
    ] }));
    grid.appendChild(make('Combination (bar + line)', { categories: months, series: [
      { name: 'Volume', data: [5, 8, 6, 9, 7, 10], type: 'bar' }, { name: 'Trend', data: [4, 6, 5, 8, 6, 9], type: 'line' },
    ] }));
    grid.appendChild(make('Dual axes', { type: 'line', categories: months, yAxis: [{ title: 'Revenue' }, { title: 'Rate' }], series: [
      { name: 'Revenue', data: [120, 190, 150, 220, 180, 250], axis: 'left' },
      { name: 'Conversion %', data: [2.1, 3.4, 2.8, 4.0, 3.2, 4.6], axis: 'right' },
    ] }));

    /* ── NEW parity features ──────────────────────────────────────────── */

    // Bubble (13th type): x/y position + `size` encodes the marker radius.
    grid.appendChild(make('Bubble', { type: 'bubble', xAxis: { type: 'linear' }, yAxis: { title: 'Margin %' }, series: [
      { name: 'Segments', points: [
        { x: 12, y: 8, size: 30 }, { x: 28, y: 22, size: 90 }, { x: 45, y: 15, size: 55 },
        { x: 62, y: 30, size: 120 }, { x: 80, y: 19, size: 70 }, { x: 95, y: 27, size: 40 },
      ] },
    ] }));

    // Numeric X axis: scatter positioned by real x values (no longer band-only).
    grid.appendChild(make('Numeric X scatter', { type: 'scatter', xAxis: { type: 'linear', title: 'Latency (ms)' }, yAxis: { title: 'Throughput' }, series: [
      { name: 'Samples', points: [
        { x: 5, y: 40 }, { x: 18, y: 32 }, { x: 33, y: 55 }, { x: 51, y: 47 },
        { x: 74, y: 68 }, { x: 96, y: 61 }, { x: 120, y: 80 },
      ] },
    ] }));

    // Interactive: wheel/drag zoom, pan, snapping crosshair, a target line, labels.
    grid.appendChild(make('Interactive (zoom · pan · crosshair)', {
      type: 'line', categories: months,
      series: [{ name: 'Revenue', data: [120, 190, 150, 220, 180, 250] }],
      zoom: { type: 'x', wheel: true, drag: true },
      pan: true,
      crosshair: { x: true, y: true, snap: true },
      annotations: [{ value: 200, axis: 'y', label: 'Target', color: '#e2477f' }],
      dataLabels: { show: true },
    }));

    // Gradient: per-series vertical gradient fill on an area chart.
    grid.appendChild(make('Gradient area', { type: 'area', categories: months, series: [
      { name: 'Flow', data: [10, 22, 18, 30, 26, 35], gradient: { direction: 'vertical', from: '#19b6c4', to: 'rgba(25,182,196,0.05)' } },
    ] }));

    // Streaming / real-time: addPoint on an interval drives a live, sliding feed.
    grid.appendChild(card('Streaming (live feed)', (h) => {
      const host = chartHost();
      h.appendChild(host);
      const WINDOW = 24; // grow up to this length, then slide (shift) the window
      const seed = [8, 12, 9, 14, 11, 16];
      const chart = new Chart(host, { height: 260, type: 'spline', categories: months.slice(), series: [{ name: 'Live', data: seed.slice() }] });
      let n = seed.length;
      let phase = seed.length;
      const id = setInterval(() => {
        if (!host.isConnected) { clearInterval(id); return; } // demo cleanup — no leak
        try {
          const next = 12 + Math.round(8 * Math.sin(phase / 2) + (Math.random() * 6 - 3));
          chart.addPoint(0, next, { shift: n >= WINDOW });
          if (n < WINDOW) n += 1;
          phase += 1;
        } catch (e) { console.warn('CHART-DEMO streaming failed:', e && e.message); clearInterval(id); }
      }, 1000);
    }, { block: true }));

    // PDF export: rasterize the chart and download a single-page PDF.
    grid.appendChild(card('PDF export', (h) => {
      const host = chartHost();
      h.appendChild(host);
      const chart = new Chart(host, { height: 220, type: 'bar', categories: months, series: [
        { name: 'Revenue', data: [12, 19, 15, 22, 18, 25] },
      ] });
      h.appendChild(triggerBtn('Export PDF', async () => {
        try {
          const blob = await chart.pdf();
          const url = URL.createObjectURL(blob);
          const a = el('a', { href: url, download: 'chart.pdf' });
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) { console.warn('CHART-DEMO pdf export failed:', e && e.message); }
      }));
    }, { block: true }));
  }, { wide: false }),
);

/* ── Pivot & Spreadsheet ───────────────────────────────────────────────── */
main.appendChild(
  section(
    'pivot',
    'Pivot',
    'A drag-and-drop pivot table that aggregates a flat dataset into a cross-tab — conditional formatting, collapsible groups, filter operator editor, custom aggregators, tree/flat modes and OOXML XLSX export.',
    (grid) => {
      grid.appendChild(card('PivotTable — enterprise (data-bar conditional format · collapsible groups · filter operator editor · multi-value + custom aggregator · tree/flat · OOXML XLSX export)', (h) => {
        const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.5rem;width:100%' });
        const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.4rem;flex-wrap:wrap;align-items:center' });
        const host = el('div', { class: 'g-host-grid' });
        const statusEl = el('div', { class: 'g-note', style: 'min-height:1.2em' });
        wrap.appendChild(bar);
        wrap.appendChild(host);
        wrap.appendChild(statusEl);
        h.appendChild(wrap);
        const setStatus = (m) => { statusEl.textContent = m; };
        const warn = (label, e) => console.warn('PIVOT-DEMO feature failed:', label, e && e.message);

        // Custom aggregator registry: a mean amount per source row ("avg ticket
        // size"). Seeded BEFORE construction (the widget pivots in its constructor)
        // and passed via the `aggregators` config so the initial compute resolves it.
        const aggregators = new AggregatorRegistry();
        try {
          aggregators.add('avgTicket', (values) => {
            const nums = values.map(Number).filter((n) => Number.isFinite(n));
            return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
          });
        } catch (e) { warn('aggregator registry', e); }

        // ── Pivot widget. Region × Quarter cross-tab summing Revenue (currency-
        //    formatted) plus an avg-ticket column driven by a CUSTOM aggregator.
        //    Demonstrates conditional data bars, collapsible row groups, a seeded
        //    filter (with the per-chip operator editor), and a value cellTemplate. ──
        const pivot = new PivotTable(host, {
          aggregators,
          data: sales,
          fields: [
            { field: 'region', label: 'Region' },
            { field: 'product', label: 'Product' },
            { field: 'quarter', label: 'Quarter' },
            { field: 'amount', label: 'Amount', aggregator: 'sum' },
            { field: 'units', label: 'Units', aggregator: 'sum' },
          ],
          rows: ['region', 'product'],
          columns: ['quarter'],
          // Multiple value fields, one of them a CUSTOM aggregator registered below.
          values: [
            { field: 'amount', aggregator: 'sum', label: 'Revenue' },
            { field: 'amount', aggregator: 'avgTicket', label: 'Avg ticket' },
          ],
          // A pre-seeded filter — the Filters chip exposes the operator+value editor.
          filters: [{ field: 'region', operator: 'in', values: ['West', 'East', 'North'] }],
          defaultFilterOperator: 'notempty',
          mode: 'tree',
          totals: { grand: true, rows: true, columns: true },
          numberFormat: { locale: 'en-US', style: 'currency', currency: 'USD', maximumFractionDigits: 0 },
          // Conditional formatting: data bars on Revenue cells + a color scale fallback.
          conditionalFormat: [
            { kind: 'dataBar', color: 'var(--jex-color-accent, #6366f1)', field: 'amount' },
            { kind: 'colorScale', min: '#eef2ff', max: '#c7d2fe', field: 'amount' },
          ],
          // Custom value-cell template: tag the column grand-total leaf cells.
          cellTemplate: ({ value, leaf }) => {
            const n = value == null ? '—' : Math.round(value).toLocaleString('en-US');
            return leaf.isTotal ? `Σ ${n}` : n;
          },
        });

        // Toolbar Button helper (matches the gallery idiom).
        const tb = (text, onClick, variant = 'secondary', icon) => {
          const b = new Button(bar, icon ? { text, icon, variant, size: 'sm' } : { text, variant, size: 'sm' });
          b.el.addEventListener('click', onClick);
          return b;
        };

        // Expand / collapse all top-level (Region) row groups via toggleNode/getCollapsed.
        let allCollapsed = false;
        tb('Collapse all', () => {
          try {
            const res = pivot.getResult();
            const topKeys = (res ? res.matrix : [])
              .filter((r) => r.collapsible && r.depth === 0 && r.nodeKey)
              .map((r) => r.nodeKey);
            allCollapsed = !allCollapsed;
            topKeys.forEach((k) => pivot.toggleNode('rows', k, allCollapsed));
            setStatus(allCollapsed
              ? `Collapsed ${topKeys.length} region group(s). Collapsed keys: ${pivot.getCollapsed('rows').length}.`
              : 'Expanded all region groups.');
          } catch (e) { warn('toggleNode', e); }
        }, 'outline', 'chevron-down');

        // Tree ⇄ flat layout toggle (re-pivots through update()).
        let flat = false;
        tb('Tree / flat', () => {
          try { flat = !flat; pivot.update({ mode: flat ? 'flat' : 'tree' }); setStatus(`Layout: ${flat ? 'flat' : 'tree'}.`); }
          catch (e) { warn('mode toggle', e); }
        }, 'outline', 'menu');

        // Real OOXML .xlsx download (zipped workbook) + legacy .xls fallback,
        // collapsed into one accessible "Export ▾" menu.
        exportMenu(bar, [
          { label: '.xlsx (OOXML)', onClick: () => {
            try { pivot.exportXlsx('pivot.xlsx'); setStatus('Exported pivot.xlsx (OOXML).'); }
            catch (e) { warn('exportXlsx', e); }
          } },
          { label: '.xls (legacy)', onClick: () => {
            try { pivot.exportXls('pivot.xls'); setStatus('Exported pivot.xls (legacy).'); }
            catch (e) { warn('exportXls', e); }
          } },
        ], { variant: 'outline' });

        // ── Enterprise scale: pivot 100,000 flat source records into a cross-tab. ──
        enterpriseSwap(bar, host, {
          key: 'pivot',
          count: '100,000 source records',
          status: setStatus,
          build: (bigHost) => {
            const records = genPivotRecords(100_000);
            new PivotTable(bigHost, {
              data: records,
              fields: [
                { field: 'region', label: 'Region' },
                { field: 'product', label: 'Product' },
                { field: 'channel', label: 'Channel' },
                { field: 'quarter', label: 'Quarter' },
                { field: 'amount', label: 'Amount', aggregator: 'sum' },
                { field: 'units', label: 'Units', aggregator: 'sum' },
              ],
              rows: ['region', 'product'],
              columns: ['quarter'],
              values: [
                { field: 'amount', aggregator: 'sum', label: 'Revenue' },
                { field: 'amount', aggregator: 'average', label: 'Avg deal' },
              ],
              mode: 'tree',
              totals: { grand: true, rows: true, columns: true },
              numberFormat: { locale: 'en-US', style: 'currency', currency: 'USD', maximumFractionDigits: 0 },
            });
          },
        });

        h.appendChild(el('div', { class: 'g-note', text: 'Region × Quarter cross-tab: Revenue (data-bar + color-scale conditional format) and an Avg-ticket column from a custom aggregator. Use the row ▾ toggles (or "Collapse all") to fold Region groups, the Filters chip’s operator/value editor to filter, "Tree / flat" to relayout, and "Export .xlsx" for a true OOXML workbook. Drag the field chips between zones to re-pivot live.' }));
      }, { block: true }));
    },
    { wide: true },
  ),
);

main.appendChild(
  section(
    'spreadsheet',
    'Spreadsheet',
    'A formula-driven spreadsheet with live recalc — data validation, conditional formatting, real OOXML XLSX export, named ranges, sort/filter, comments, an embedded chart and cell protection.',
    (grid) => {
      grid.appendChild(card('Spreadsheet — full enterprise workbook (validation · conditional formats · XLSX · named ranges · sort/filter · comments · embedded chart · protection)', (h) => {
        const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.5rem;width:100%' });
        const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.4rem;flex-wrap:wrap;align-items:center' });
        const host = el('div', { class: 'g-host-grid', style: 'min-height:340px' });
        const statusEl = el('div', { class: 'g-note', style: 'min-height:1.2em' });
        wrap.appendChild(bar);
        wrap.appendChild(host);
        wrap.appendChild(statusEl);
        h.appendChild(wrap);
        const setStatus = (m) => { statusEl.textContent = m; };
        const warn = (label, e) => console.warn('SHEET-DEMO feature failed:', label, e && e.message);

        // ── Workbook: a regional sales sheet (the demo body) + a Q-summary sheet
        //    that references a named range, exercising cross-cell recalc. ──
        const ss = new Spreadsheet(host, {
          maxRows: 16,
          sheets: [
            {
              id: 'sales',
              name: 'Sales',
              rowCount: 50,
              colCount: 8,
              cells: {
                '0,0': { value: 'Region', style: { bold: true } },
                '0,1': { value: 'Rep', style: { bold: true } },
                '0,2': { value: 'Status', style: { bold: true } },
                '0,3': { value: 'Units', style: { bold: true } },
                '0,4': { value: 'Revenue', style: { bold: true } },
                '1,0': { value: 'North' }, '1,1': { value: 'Ana' }, '1,2': { value: 'Won' },
                '1,3': { value: 120 }, '1,4': { value: 5400, format: { type: 'currency', numberFormat: '#,##0' } },
                '2,0': { value: 'South' }, '2,1': { value: 'Ben' }, '2,2': { value: 'Open' },
                '2,3': { value: 64 }, '2,4': { value: 2100, format: { type: 'currency', numberFormat: '#,##0' } },
                '3,0': { value: 'East' }, '3,1': { value: 'Cara' }, '3,2': { value: 'Won' },
                '3,3': { value: 210 }, '3,4': { value: 8900, format: { type: 'currency', numberFormat: '#,##0' } },
                '4,0': { value: 'West' }, '4,1': { value: 'Dev' }, '4,2': { value: 'Open' },
                '4,3': { value: 38 }, '4,4': { value: 1500, format: { type: 'currency', numberFormat: '#,##0' } },
                '5,0': { value: 'Central' }, '5,1': { value: 'Eve' }, '5,2': { value: 'Won' },
                '5,3': { value: 155 }, '5,4': { value: 6700, format: { type: 'currency', numberFormat: '#,##0' } },
                '6,0': { value: 'Total', style: { bold: true } },
                '6,3': { formula: 'SUM(D2:D6)', style: { bold: true } },
                '6,4': { formula: 'SUM(E2:E6)', format: { type: 'currency', numberFormat: '#,##0' }, style: { bold: true } },
              },
            },
            {
              id: 'summary',
              name: 'Summary',
              rowCount: 20,
              colCount: 6,
              cells: {
                '0,0': { value: 'Metric', style: { bold: true } },
                '0,1': { value: 'Value', style: { bold: true } },
                '1,0': { value: 'Total revenue (named range)' },
                // Uses the `Revenue` named range defined below → =SUM(Revenue).
                '1,1': { formula: 'SUM(Revenue)', format: { type: 'currency', numberFormat: '#,##0' } },
                '2,0': { value: 'Average deal' },
                '2,1': { formula: 'AVERAGE(Revenue)', format: { type: 'currency', numberFormat: '#,##0' } },
              },
            },
          ],
        });

        const api = ss.getApi();
        const sheetGrid = ss.getGrid();
        // Sheet-local rectangle helper {top,left,bottom,right} for the API methods.
        const rng = (top, left, bottom, right) => ({ top, left, bottom, right });

        // ── 1) Named range: E2:E6 → "Revenue" (drives the Summary sheet formulas). ──
        try { ss.defineName('Revenue', 'Sales!E2:E6'); } catch (e) { warn('defineName', e); }

        // ── 2) Data validation: Status column (C2:C6) → an enforced dropdown list.
        //    Invalid input is vetoed and emits `editRejected`. ──
        try {
          ss.setValidation({ kind: 'list', values: ['Won', 'Open', 'Lost'] }, rng(1, 2, 5, 2));
        } catch (e) { warn('setValidation', e); }
        try {
          ss.on('editRejected', (ev) => setStatus('Edit rejected (' + ev.reason + ')' + (ev.message ? ': ' + ev.message : '')));
        } catch (e) { warn('on editRejected', e); }

        // ── 3) Conditional formatting on the Revenue column (E2:E6): a data-bar
        //    plus a cell-value highlight for the strongest deals. ──
        try {
          ss.addConditionalFormat({ kind: 'dataBar', colorToken: '--jects-cmyk-cyan' }, rng(1, 4, 5, 4));
        } catch (e) { warn('addConditionalFormat dataBar', e); }
        try {
          ss.addConditionalFormat(
            { kind: 'cellValue', op: '>=', value: 6000, style: { backgroundToken: '--jects-cmyk-yellow-soft', bold: true } },
            rng(1, 4, 5, 4),
          );
        } catch (e) { warn('addConditionalFormat cellValue', e); }
        // A 3-color scale across the Units column (D2:D6).
        try {
          ss.addConditionalFormat(
            { kind: 'colorScale', minToken: '--jects-destructive', midToken: '--jects-warning', maxToken: '--jects-success' },
            rng(1, 3, 5, 3),
          );
        } catch (e) { warn('addConditionalFormat colorScale', e); }

        // ── 4) Comment indicator on a header cell. ──
        try { ss.setComment({ row: 0, col: 4 }, 'Net revenue, USD — booked deals only.'); } catch (e) { warn('setComment', e); }

        // ── 5) Frozen header row. ──
        try { ss.setFrozen({ rows: 1, cols: 0 }); } catch (e) { warn('setFrozen', e); }

        // ── Toolbar (matches the gallery `tb(...)` idiom). ──
        const tb = (text, onClick, variant = 'secondary', icon) => {
          const b = new Button(bar, icon ? { text, icon, variant, size: 'sm' } : { text, variant, size: 'sm' });
          b.el.addEventListener('click', onClick);
          return b;
        };

        // Sort Revenue descending (whole records reorder; column is absolute).
        tb('Sort by revenue', () => {
          try { ss.sortRange({ column: 4, dir: 'desc' }, rng(1, 0, 5, 4)); setStatus('Sorted rows by Revenue (desc).'); }
          catch (e) { warn('sortRange', e); }
        }, 'outline', 'filter');

        // Filter: keep only "Won" rows (hide the rest).
        tb('Filter: Won only', () => {
          try { ss.applyFilter(2, (v) => v === 'Won', rng(1, 0, 5, 4)); setStatus('Filtered to Status = Won.'); }
          catch (e) { warn('applyFilter', e); }
        }, 'outline', 'filter');

        tb('Clear filter', () => {
          try { ss.clearFilter(); setStatus('Filter cleared.'); } catch (e) { warn('clearFilter', e); }
        }, 'ghost');

        // Embedded chart from the Region × Revenue range: Region (col 0) supplies
        // the category labels, Revenue (col 4) the bar series; the header row gives
        // the series its name. The block spans cols 0–4 so both come through.
        let chartInserted = false;
        tb('Insert chart', () => {
          if (chartInserted) return;
          try {
            ss.insertChart(rng(0, 0, 5, 4), { type: 'bar' });
            chartInserted = true;
            setStatus('Embedded bar chart inserted from the Region × Revenue range.');
          } catch (e) { warn('insertChart', e); }
        }, 'outline', 'check');

        // Real XLSX export → browser download.
        tb('Export XLSX', () => {
          try {
            const blob = ss.exportXlsxBlob();
            const url = URL.createObjectURL(blob);
            const a = el('a', { href: url, download: 'sales.xlsx' });
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setStatus('Exported sales.xlsx (' + blob.size + ' bytes).');
          } catch (e) { warn('exportXlsxBlob', e); }
        }, 'secondary', 'arrow-down');

        // Protect the sheet: the formula totals (row 7) are locked; everything
        // else is opened so the body stays editable while protection is on.
        let prot = false;
        tb('Protect sheet', (ev) => {
          prot = !prot;
          try {
            if (prot) {
              ss.setCellsLocked(false, rng(0, 0, 5, 4)); // open the body
              ss.setCellsLocked(true, rng(6, 0, 6, 4));   // lock the totals
              ss.setSheetProtected(true);
              setStatus('Sheet protected — the Total row is locked (editing it is vetoed).');
            } else {
              ss.setSheetProtected(false);
              setStatus('Sheet unprotected.');
            }
          } catch (e) { warn('protection', e); }
          ev.currentTarget?.setAttribute?.('aria-pressed', String(prot));
        }, 'ghost');

        // Drag-fill series: seed two cells in col G then extend the series down.
        tb('Fill series', () => {
          try {
            api.setValue({ sheet: 'sales', row: 1, col: 6 }, 1);
            api.setValue({ sheet: 'sales', row: 2, col: 6 }, 2);
            sheetGrid.update({});
            ss.fillTo(rng(1, 6, 2, 6), { row: 5, col: 6 });
            setStatus('Filled an arithmetic series (1,2,3,4,5) down column G.');
          } catch (e) { warn('fillTo', e); }
        }, 'ghost');

        // ── Enterprise scale: a budget workbook of ~10,000 populated cells with
        //    per-row Total (=SUM) and a footer row of per-column SUM formulas. ──
        enterpriseSwap(bar, host, {
          key: 'spreadsheet',
          count: '~10,000 cells + formulas',
          status: setStatus,
          build: (bigHost) => {
            const budget = genBudgetSheet(700);
            new Spreadsheet(bigHost, {
              maxRows: 28,
              sheets: [{
                id: 'budget',
                name: 'Budget',
                rowCount: budget.rowCount,
                colCount: budget.colCount,
                cells: budget.cells,
              }],
            });
          },
        });

        h.appendChild(el('div', { class: 'g-note', text: 'A live enterprise workbook. The Status column is a validated dropdown (invalid input is vetoed); the Units column carries a red→amber→green color scale and Revenue carries data-bars plus a high-value highlight; E1 has a comment. The named range Revenue feeds =SUM(Revenue) on the Summary tab. Use the toolbar to sort, filter, insert a chart, protect the sheet (the Total row locks), fill a series, and export a real .xlsx.' }));
      }, { block: true }));
    },
    { wide: true },
  ),
);

/* ── Scheduling (Wave 4) ───────────────────────────────────────────────── */
main.appendChild(
  section(
    'scheduler',
    'Scheduler',
    'A resource scheduler on a shared timeline engine — non-working-time shading, multi-assignment, visual + editable dependencies, global & per-resource time ranges, RRULE recurrence, travel time, the event editor, undo/redo and orientation + zoom controls.',
    (grid) => {
      /* — Scheduler: resources × events across a time range —
         Enterprise feature tail on show: a working-time CALENDAR (weekends +
         off-hours shaded), MULTI-ASSIGNMENT (one event spanning two resources
         via the assignments store; a resource carrying several events), global
         TimeRanges (a shaded "Sprint review" band), per-resource
         ResourceTimeRanges (Bob's PTO), drag-to-pan + infinite time-axis
         scroll, recurring events (RRULE), EDITABLE visual dependencies, pre/post
         travel time, the double-click event editor, an UNDO/REDO stack (real
         SchedulerStm), and orientation + zoom toolbar controls. */
      grid.appendChild(card('Scheduler — non-working shading · multi-assignment · editable deps · editor · undo/redo · orientation + zoom', (h) => {
        const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;margin-bottom:.5rem' });
        h.appendChild(bar);
        const status = el('span', { class: 'g-note', style: 'margin-left:.5rem;align-self:center' });
        const host = el('div', { style: 'height:var(--g-page-host);width:100%' });
        h.appendChild(host);
        const base = Date.UTC(2026, 5, 22); // Monday
        const sched = new Scheduler(host, {
          // A realistic field crew (6 people) rather than three placeholders.
          resources: [
            { id: 'r1', name: 'Alice Nguyen', role: 'Lead', capacity: 1 },
            { id: 'r2', name: 'Bob Martin', role: 'Field', capacity: 1 },
            { id: 'r3', name: 'Carol Diaz', role: 'Field', capacity: 2 },
            { id: 'r4', name: 'Dave Okafor', role: 'Install', capacity: 1 },
            { id: 'r5', name: 'Erin Walsh', role: 'Survey', capacity: 1 },
            { id: 'r6', name: 'Frank Li', role: 'Support', capacity: 1 },
          ],
          events: [
            { id: 'e1', resourceId: 'r1', name: 'Design review', startDate: base + HOUR * 9, endDate: base + HOUR * 12 },
            { id: 'e2', resourceId: 'r1', name: 'Build', startDate: base + HOUR * 13, endDate: base + HOUR * 17, eventColor: 'cyan' },
            // Travel time: 1h pre + 1h post flanking the on-site QA pass.
            { id: 'e3', resourceId: 'r2', name: 'QA pass (on-site)', startDate: base + DAY + HOUR * 9, endDate: base + DAY + HOUR * 15, eventColor: 'magenta', preTravelTime: HOUR, postTravelTime: HOUR },
            { id: 'e4', resourceId: 'r3', name: 'Standup', startDate: base + HOUR * 9, endDate: base + HOUR * 10, recurrenceRule: 'FREQ=DAILY;COUNT=5' },
            { id: 'e5', resourceId: 'r4', name: 'Equipment install', startDate: base + HOUR * 10, endDate: base + HOUR * 15, eventColor: 'yellow' },
            { id: 'e6', resourceId: 'r5', name: 'Site survey', startDate: base + DAY + HOUR * 9, endDate: base + DAY + HOUR * 12 },
            { id: 'e7', resourceId: 'r6', name: 'Customer call-out', startDate: base + HOUR * 14, endDate: base + HOUR * 16, eventColor: 'cyan' },
            { id: 'e8', resourceId: 'r4', name: 'Handover', startDate: base + DAY * 2 + HOUR * 11, endDate: base + DAY * 2 + HOUR * 13 },
            // Multi-assignment anchor: a joint install with NO resourceId — it is
            // placed onto two resources via the assignments store below.
            { id: 'e9', name: 'Joint rollout (2 crew)', startDate: base + DAY * 2 + HOUR * 9, endDate: base + DAY * 2 + HOUR * 12, eventColor: 'magenta' },
          ],
          // Many-to-many assignments: e9 is shared by Alice + Carol; Carol also
          // carries the recurring standup (a resource with several events).
          assignments: [
            { id: 'a1', eventId: 'e9', resourceId: 'r1' },
            { id: 'a2', eventId: 'e9', resourceId: 'r3' },
            { id: 'a3', eventId: 'e4', resourceId: 'r3' },
          ],
          dependencies: [
            { id: 'd1', fromId: 'e1', toId: 'e2', type: 'FS' },
            { id: 'd2', fromId: 'e2', toId: 'e9', type: 'FS' },
          ],
          // Editable dependencies: hover a bar edge to draw a new link.
          dependenciesEditable: true,
          // Working-time calendar → weekends + before-9 / after-17 shading.
          calendar: { weekendDays: [0, 6], dayStartHour: 9, dayEndHour: 17 },
          showNonWorkingTime: true,
          // Global time range shaded across every resource row.
          timeRanges: [
            { id: 'tr1', startDate: base + HOUR * 12, endDate: base + HOUR * 13, name: 'Lunch' },
            { id: 'tr2', startDate: base + DAY + HOUR * 15, endDate: base + DAY + HOUR * 17, name: 'Sprint review' },
          ],
          // Per-resource range: Bob is out on day 1.
          resourceTimeRanges: [
            { id: 'rtr1', resourceId: 'r2', startDate: base + HOUR * 9, endDate: base + HOUR * 18, name: 'PTO' },
          ],
          preset: HOUR_AND_DAY,
          // 7-day window (Mon→Sun) so the weekend paints as non-working shading.
          range: { start: base, end: base + DAY * 7 },
          creatable: true,
          editable: true,
          panEnabled: true,
          infiniteScroll: true,
          eventTooltip: (e) => e.name ?? null,
        });

        // ── Host toolbar driving the real public API ──────────────────────
        const tb = (text, onClick, variant = 'secondary') => {
          const b = new Button(bar, { text, variant, size: 'sm' });
          b.el.addEventListener('click', onClick);
          return b;
        };
        const warn = (label, e) => console.warn('SCHED-DEMO feature failed:', label, e && e.message);

        // Zoom in / out (real ViewPreset ladder).
        tb('Zoom in', () => { try { sched.zoomIn(); status.textContent = 'Zoomed in.'; } catch (e) { warn('zoomIn', e); } }, 'outline');
        tb('Zoom out', () => { try { sched.zoomOut(); status.textContent = 'Zoomed out.'; } catch (e) { warn('zoomOut', e); } }, 'outline');

        // Orientation toggle (horizontal rows ⇄ vertical columns).
        let vertical = false;
        const orientBtn = tb('Orientation: horizontal', () => {
          vertical = !vertical;
          try {
            sched.update({ orientation: vertical ? 'vertical' : 'horizontal' });
            orientBtn.el.textContent = 'Orientation: ' + (vertical ? 'vertical' : 'horizontal');
          } catch (e) { warn('orientation', e); }
        }, 'outline');

        // Open the built-in event editor popup on a representative event.
        tb('Edit event', () => {
          try { sched.editEvent(sched.getEventStore().getById('e2')); status.textContent = 'Opened the event editor.'; }
          catch (e) { warn('editEvent', e); }
        }, 'ghost');

        // Undo / redo via a real SchedulerStm tracking the event + dependency
        // stores. Drag/resize/create/delete + link edits all land on the stack.
        let stm = null;
        const undoBtn = tb('Undo', () => { try { stm && stm.undo(); } catch (e) { warn('undo', e); } }, 'ghost');
        const redoBtn = tb('Redo', () => { try { stm && stm.redo(); } catch (e) { warn('redo', e); } }, 'ghost');
        try {
          stm = new SchedulerStm({
            stores: [
              { name: 'events', store: sched.getEventStore() },
              { name: 'dependencies', store: sched.getDependencyStore() },
            ],
          });
          const syncStm = () => { undoBtn.el.disabled = !stm.canUndo; redoBtn.el.disabled = !stm.canRedo; };
          stm.on('change', syncStm); syncStm();
        } catch (e) { warn('stm', e); undoBtn.el.disabled = true; redoBtn.el.disabled = true; }
        bar.appendChild(status);

        // ── Enterprise scale: 100 resources × ~2,000 events across 4 weeks. ──
        enterpriseSwap(bar, host, {
          key: 'scheduler',
          count: '100 resources × ~2,000 events',
          build: (bigHost) => {
            const data = genSchedulerData(100, 20);
            new Scheduler(bigHost, {
              resources: data.resources,
              events: data.events,
              preset: HOUR_AND_DAY,
              range: { start: data.base, end: data.base + DAY * 20 },
              panEnabled: true,
              infiniteScroll: true,
              eventTooltip: (e) => e.name ?? null,
            });
          },
        });
      }, { block: true }));

      /* — Gantt: enterprise project plan —
         WBS task tree + summary roll-ups, FS/SS dependencies, %-done,
         milestones, critical-path highlight, a captured baseline overlay,
         a status/progress line, constraint/deadline indicators, resource
         assignments (Resources column), project marker lines, and a toolbar
         with CSV + PNG export. */
    },
    { wide: true },
  ),
);

main.appendChild(
  section(
    'gantt',
    'Gantt',
    'A full enterprise project plan — WBS task tree, critical path, baselines, dependencies, resource histogram & utilization, undo/redo, PERT view, rollups, a progress line, and PDF/PNG/Excel/MS-Project export.',
    (grid) => {
      grid.appendChild(card('Gantt — full enterprise project plan (critical path · resources · histogram · undo · PERT · exports)', (h) => {
        const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.5rem;width:100%' });
        const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.4rem;flex-wrap:wrap;align-items:center' });
        const host = el('div', { style: 'height:var(--g-page-host);width:100%' });
        // Side-by-side resource panels under the chart (histogram | utilization).
        const panels = el('div', { style: 'display:flex;gap:.5rem;width:100%;flex-wrap:wrap' });
        const histHost = el('div', { style: 'flex:1 1 320px;min-width:280px;height:180px;overflow:auto' });
        const utilHost = el('div', { style: 'flex:1 1 320px;min-width:280px;height:180px;overflow:auto' });
        panels.appendChild(histHost);
        panels.appendChild(utilHost);
        // PERT network-diagram view, hidden until toggled.
        const pertHost = el('div', { style: 'display:none;height:300px;width:100%;border-top:1px solid var(--jects-border,#3a3a42)' });
        const statusEl = el('div', { class: 'g-note', style: 'min-height:1.2em' });
        wrap.appendChild(bar);
        wrap.appendChild(host);
        wrap.appendChild(panels);
        wrap.appendChild(pertHost);
        wrap.appendChild(statusEl);
        h.appendChild(wrap);

        const T0 = Date.UTC(2026, 5, 1); // Mon 1 Jun 2026
        const STATUS = T0 + 24 * DAY;    // "today" / status date
        // A tighter horizontal scale so the whole ~7-week plan fits without clipping.
        const ganttPreset = { ...WEEK_AND_DAY, pxPerUnit: 20 };
        const HPD = 8 * HOUR; // working hours/day → effort in ms

        const t = (id, name, parentId, offDays, durDays, percentDone, extra = {}) => ({
          id, name, parentId,
          start: T0 + offDays * DAY,
          duration: durDays * DAY,
          end: T0 + (offDays + durDays) * DAY,
          percentDone,
          effort: durDays * HPD,
          ...extra,
        });

        const tasks = [
          // 1 — Discovery (summary)
          { id: 'd', name: 'Discovery', expanded: true, rollup: true },
          t('d1', 'Stakeholder interviews', 'd', 0, 3, 1, { rollup: true }),
          t('d2', 'Requirements doc', 'd', 3, 4, 1, { deadline: T0 + 6 * DAY, rollup: true }),
          t('d3', 'Tech spike', 'd', 3, 3, 1),
          // 2 — Design (summary)
          { id: 'g', name: 'Design', expanded: true, rollup: true },
          t('g1', 'UX wireframes', 'g', 7, 5, 0.9),
          t('g2', 'Visual design', 'g', 10, 5, 0.6),
          t('g3', 'Design review', 'g', 15, 1, 0, { constraintType: 'mustStartOn', constraintDate: T0 + 15 * DAY }),
          // 3 — Build (summary) — Frontend ships as a SPLIT / segmented task.
          { id: 'b', name: 'Build', expanded: true, rollup: true },
          t('b1', 'Frontend', 'b', 16, 12, 0.45, {
            segments: [
              { id: 'b1s1', start: T0 + 16 * DAY, end: T0 + 22 * DAY },
              { id: 'b1s2', start: T0 + 25 * DAY, end: T0 + 30 * DAY },
            ],
          }),
          t('b2', 'Backend / API', 'b', 16, 14, 0.5),
          t('b3', 'Integration', 'b', 30, 4, 0, { deadline: T0 + 33 * DAY }),
          // 4 — Launch (summary)
          { id: 'l', name: 'Launch', expanded: true, rollup: true },
          t('l1', 'QA & UAT', 'l', 34, 6, 0),
          t('l2', 'Deploy to prod', 'l', 40, 2, 0),
          { id: 'm', name: 'Go-live', parentId: 'l', start: T0 + 42 * DAY, milestone: true, rollup: true },
        ];

        const dependencies = [
          { id: 'k1', fromId: 'd1', toId: 'd2', type: 'FS' },
          { id: 'k2', fromId: 'd1', toId: 'd3', type: 'SS' },
          { id: 'k3', fromId: 'd2', toId: 'g1', type: 'FS' },
          { id: 'k4', fromId: 'g1', toId: 'g2', type: 'SS', lag: 3 * DAY },
          { id: 'k5', fromId: 'g2', toId: 'g3', type: 'FS' },
          { id: 'k6', fromId: 'g3', toId: 'b1', type: 'FS' },
          { id: 'k7', fromId: 'g3', toId: 'b2', type: 'FS' },
          { id: 'k8', fromId: 'b1', toId: 'b3', type: 'FS' },
          { id: 'k9', fromId: 'b2', toId: 'b3', type: 'FS' },
          { id: 'k10', fromId: 'b3', toId: 'l1', type: 'FS' },
          { id: 'k11', fromId: 'l1', toId: 'l2', type: 'FS' },
          { id: 'k12', fromId: 'l2', toId: 'm', type: 'FS' },
        ];

        // Rich column set: defaults (name/WBS/start/finish/duration/%-done/
        // predecessors) + symmetric successors + effort + a rolled-up % summary.
        const columns = [
          ...DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
          { field: 'effort', header: 'Effort', width: 80 },
          rollupColumn({ kind: 'summary', field: 'percentDone', aggregation: 'avg', header: 'Rollup %' }),
        ];

        // Resource layer: people + equipment + assignments. Passing these as
        // GanttOptions makes the widget AUTO-INSTALL the resource layer so
        // `gantt.resources` is populated (the histogram / utilization read it)
        // and the grid gains a live "Resources" column (avatar/initials chips).
        const resources = [
          { id: 'ana', name: 'Ana Pereira', capacity: 1 },
          { id: 'ben', name: 'Ben Cohen', capacity: 1 },
          { id: 'cara', name: 'Cara Singh', capacity: 1 },
          { id: 'dev', name: 'Dev Team', capacity: 4 },
          { id: 'qa', name: 'QA Team', capacity: 3 },
        ];
        const assignments = [
          ['d1', 'ana', 100], ['d2', 'ana', 100], ['d3', 'ben', 100],
          ['g1', 'cara', 100], ['g2', 'cara', 80], ['g3', 'ana', 100],
          ['b1', 'dev', 100], ['b2', 'dev', 100], ['b3', 'dev', 100],
          ['l1', 'qa', 100], ['l2', 'ben', 100],
          // Deliberate over-allocation: Ana also booked 80% on Visual design.
          ['g2', 'ana', 80],
        ].map(([taskId, resourceId, units], i) => ({ id: 'as' + i, taskId, resourceId, units }));

        const gantt = new Gantt(host, {
          projectStart: T0,
          preset: ganttPreset,
          showCriticalPath: true,
          columns,
          tasks,
          dependencies,
          resources,
          assignments,
        });

        // Baseline overlay: snapshot the as-planned schedule, then nudge a few
        // tasks so live bars diverge from the baseline (variance reads visibly).
        try {
          gantt.captureBaseline('plan', 'As-planned');
          gantt.updateTaskSpan('g2', { start: T0 + 11 * DAY, end: T0 + 16 * DAY }); // slipped
          gantt.captureBaseline('rev2', 'Re-plan');
          gantt.showBaseline('plan');
        } catch (e) { console.warn('Gantt demo: baseline unavailable —', e && e.message); }

        // Status / progress line at the status date (line of balance).
        try {
          gantt.use(new GanttProgressLineFeature({ statusDate: STATUS, label: 'Status' }));
        } catch (e) { console.warn('Gantt demo: progressLine unavailable —', e && e.message); }

        // Constraint / deadline / late-finish indicator glyphs on bars.
        try { gantt.use(new GanttIndicatorsFeature()); } catch (e) { console.warn('Gantt demo: indicators unavailable —', e && e.message); }

        // Child-task rollup markers on summary bars (always-on so they read here).
        try { gantt.use(new GanttRollupFeature({ mode: 'always' })); } catch (e) { console.warn('Gantt demo: rollups unavailable —', e && e.message); }

        // Split / segmented tasks (renders Frontend's two pieces + connector).
        try { gantt.use(new GanttSegmentedTasksFeature()); } catch (e) { console.warn('Gantt demo: segmentedTasks unavailable —', e && e.message); }

        // Multi-baseline compare picker (overlay + keyboard-operable toggles).
        try {
          gantt.use(new MultiBaselineCompare({
            initialBaselines: [
              { id: 'plan', name: 'As-planned', active: true },
              { id: 'rev2', name: 'Re-plan', active: false },
            ],
          }));
        } catch (e) { console.warn('Gantt demo: multiBaseline unavailable —', e && e.message); }

        // Full-height project marker lines (status date + go-live target).
        // ProjectLines is a standalone renderer (NOT a gantt.use feature): build
        // it against the live axis and mount its layer into the bars content.
        let projLines = null;
        try {
          projLines = new ProjectLines({
            axis: gantt.timeline.axis,
            lines: [
              { id: 'status', date: STATUS, label: 'Status', kind: 'status' },
              { id: 'target', date: T0 + 42 * DAY, label: 'Target go-live', kind: 'deadline' },
            ],
          });
          let lineObserver = null;
          const mountLines = () => {
            if (!projLines) return false;
            const root = gantt.el || gantt.timeline.el;
            const bars = root?.querySelector?.('.jects-gantt__bars');
            if (!bars) return false;
            if (projLines.el.parentElement !== bars) bars.appendChild(projLines.el);
            try { projLines.setHeight(bars.scrollHeight || 360); } catch (_) {}
            try { projLines.refresh(); } catch (_) {}
            // The Gantt re-renders the bars layer on schedule/scroll, wiping
            // overlays; observe it and re-attach our line layer when that happens
            // (mirrors how the built-in overlay features persist).
            if (!lineObserver && window.MutationObserver) {
              lineObserver = new MutationObserver(() => {
                if (projLines && projLines.el.parentElement !== bars) {
                  bars.appendChild(projLines.el);
                  try { projLines.setHeight(bars.scrollHeight || 360); projLines.refresh(); } catch (_) {}
                }
              });
              lineObserver.observe(bars, { childList: true });
            }
            return true;
          };
          // The grid/timeline mounts asynchronously, so retry until the bars
          // layer exists, then keep it sized on every reschedule.
          let tries = 0;
          const tryMount = () => {
            if (mountLines() || tries++ > 120) return;
            setTimeout(tryMount, 50);
          };
          tryMount();
          gantt.on('scheduleChange', mountLines);
        } catch (e) { console.warn('Gantt demo: projectLines unavailable —', e && e.message); }

        // Undo / redo (STM): drive our own toolbar buttons, keyboard shortcuts on.
        let undoFeat = null;
        try { undoFeat = gantt.use(new GanttUndoRedo({ toolbar: false })); } catch (e) { console.warn('Gantt demo: undo unavailable —', e && e.message); }

        // Export surface: the Gantt AUTO-INSTALLS the CSV/Excel/ICS/PNG/PDF method
        // features by default (exportCsv/exportXlsx/exportIcs/exportPng/exportPdf
        // are already grafted). We only add the visible unified Export menu (which
        // is NOT auto-installed) so a CSV/Excel/PNG/PDF/ICS/MS-Project + Print
        // dispatcher button floats in the chart's top-end corner.
        try { gantt.use(new GanttExportMenu({ filename: 'project-plan' })); } catch (e) { console.warn('Gantt demo: exportMenu unavailable —', e && e.message); }

        // Resource Histogram — capacity vs allocation, shares the chart's axis.
        let hist = null;
        try {
          if (gantt.resources) {
            hist = new ResourceHistogram(histHost, {
              api: gantt.resources,
              axis: gantt.timeline.axis,
              getTaskSpan: (id) => gantt.getTask(id),
              bucketMs: DAY,
              label: 'Resource histogram',
            });
            hist.refresh();
          } else {
            histHost.appendChild(el('div', { class: 'g-note', text: 'Histogram needs a resource layer.' }));
          }
        } catch (e) { console.warn('Gantt demo: histogram unavailable —', e && e.message); }

        // Resource Utilization — per-resource × per-week allocation grid.
        let util = null;
        try {
          if (gantt.resources) {
            util = new ResourceUtilizationView(utilHost, {
              api: gantt.resources,
              tasks: gantt,
              unit: 'week',
              cellMode: 'percent',
              label: 'Resource utilization',
            });
          }
        } catch (e) { console.warn('Gantt demo: utilization unavailable —', e && e.message); }

        // Keep the panels live as the schedule changes (undo/redo, ASAP/ALAP).
        try {
          gantt.on('scheduleChange', () => { try { hist?.refresh(); } catch (_) {} });
          gantt.on('taskChange', () => { try { hist?.refresh(); } catch (_) {} });
        } catch (e) { console.warn('Gantt demo: events unavailable —', e && e.message); }

        // PERT / network-diagram view, built from the live Gantt schedule.
        let pert = null;
        const ensurePert = () => {
          if (pert) return pert;
          try {
            pert = PertView.fromGantt(pertHost, gantt, { tasks, dependencies, showCriticalPath: true });
          } catch (_) { pert = null; }
          return pert;
        };

        /* ── Toolbar ──────────────────────────────────────────────────── */
        const tb = (text, onClick, variant = 'secondary', icon) => {
          const b = new Button(bar, icon ? { text, icon, variant, size: 'sm' } : { text, variant, size: 'sm' });
          b.el.addEventListener('click', onClick);
          return b;
        };

        let cpOn = true;
        tb('Critical path', (e) => {
          cpOn = !cpOn;
          try { gantt.setCriticalPathVisible(cpOn); } catch (_) {}
          e.currentTarget?.setAttribute?.('aria-pressed', String(cpOn));
        }, 'outline', 'check');

        let blOn = true;
        tb('Baseline', () => {
          blOn = !blOn;
          try { gantt.showBaseline(blOn ? 'plan' : null); } catch (_) {}
        }, 'outline', 'filter');

        // Undo / redo, driving the STM.
        const undoBtn = tb('Undo', () => { try { undoFeat?.undo(); } catch (_) {} syncUndo(); }, 'ghost', 'chevron-left');
        const redoBtn = tb('Redo', () => { try { undoFeat?.redo(); } catch (_) {} syncUndo(); }, 'ghost', 'chevron-right');
        function syncUndo() {
          try {
            undoBtn.el.disabled = !(undoFeat?.canUndo);
            redoBtn.el.disabled = !(undoFeat?.canRedo);
          } catch (_) {}
        }
        // `stmChange` is the authoritative undo/redo-state signal from the STM.
        try { gantt.on('stmChange', syncUndo); } catch (_) {}
        try { gantt.on('scheduleChange', syncUndo); gantt.on('taskChange', syncUndo); } catch (_) {}
        syncUndo();

        // Make an edit (so Undo/Redo has something real to operate on). QA & UAT
        // is a plain leaf task, so the span edit is recorded by the STM cleanly.
        tb('Edit task (QA)', () => {
          try { gantt.updateTaskSpan('l1', { start: T0 + 34 * DAY, end: T0 + 41 * DAY }); } catch (_) {}
          syncUndo();
        }, 'ghost');

        // ASAP / ALAP explicit scheduling-direction toggle (re-runs the engine).
        let alap = false;
        tb('ASAP / ALAP', (e) => {
          alap = !alap;
          try {
            gantt.reschedule({
              direction: alap ? 'backward' : 'forward',
              projectStart: T0,
              projectEnd: T0 + 42 * DAY,
            });
          } catch (_) {}
          e.currentTarget?.setAttribute?.('aria-pressed', String(alap));
          statusEl.textContent = alap ? 'Scheduling mode: ALAP (backward from deadline)' : 'Scheduling mode: ASAP (forward from project start)';
          try { hist?.refresh(); } catch (_) {}
        }, 'outline');

        // Split / join the Frontend task interactively.
        const splitFeat = () => gantt.features?.get?.('segmentedTasks');
        tb('Split / Join', () => {
          try {
            const f = splitFeat();
            if (!f) return;
            if (f.segmentsOf('b1').length > 1) f.joinAll('b1');
            else f.split('b1', T0 + 23 * DAY);
            hist?.refresh();
          } catch (_) {}
        }, 'ghost');

        // PERT chart view toggle (swaps the chart for the network diagram).
        let pertOn = false;
        tb('PERT view', (e) => {
          pertOn = !pertOn;
          if (pertOn) {
            host.style.display = 'none';
            panels.style.display = 'none';
            pertHost.style.display = '';
            const p = ensurePert();
            try { p?.refresh?.(); p?.zoomToFit?.(); } catch (_) {}
          } else {
            host.style.display = '';
            panels.style.display = 'flex';
            pertHost.style.display = 'none';
          }
          e.currentTarget?.setAttribute?.('aria-pressed', String(pertOn));
        }, 'outline');

        // Utilization drill-down expand-all.
        tb('Expand utilization', () => { try { util?.expandAll(); } catch (_) {} }, 'ghost');

        // Direct export formats (each calls a real grafted method), collapsed
        // into one accessible "Export ▾" menu — mirroring the component's own
        // built-in floating GanttExportMenu.
        exportMenu(bar, [
          { label: 'CSV', onClick: () => { try { gantt.exportCsvDownload?.('project-plan.csv'); } catch (_) {} } },
          { label: 'Excel', onClick: () => { try { gantt.exportXlsxDownload?.('project-plan.xlsx'); } catch (_) {} } },
          { label: 'PNG', onClick: () => { try { gantt.exportPng?.({ download: 'project-plan.png' }); } catch (_) {} } },
          { label: 'PDF', onClick: () => { try { gantt.exportPdf?.({ page: 'A4', orientation: 'landscape', fitToWidth: true, download: 'project-plan.pdf' }); } catch (_) {} } },
          { label: 'ICS', onClick: () => { try { gantt.exportIcs?.({ download: true, fileName: 'project-plan' }); } catch (_) {} } },
          { label: 'MS-Project', onClick: () => {
            try {
              const xml = ganttToMsProjectXml(gantt, { baselines: [] });
              const blob = new Blob([xml], { type: 'application/xml' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'project-plan.xml';
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 0);
            } catch (_) {}
          } },
          { label: 'Print', onClick: () => {
            try {
              const menu = gantt.features?.get?.('gantt-export-menu');
              if (menu?.exportFormat) menu.exportFormat('print');
              else window.print();
            } catch (_) { try { window.print(); } catch (__) {} }
          } },
        ]);

        // ── Enterprise scale: a multi-phase WBS of 1,000 tasks + ~2,000 deps. ──
        enterpriseSwap(bar, host, {
          key: 'gantt',
          count: '1,000 tasks · ~2,000 deps',
          status: (m) => { statusEl.textContent = m; },
          // The resource panels + PERT host belong to the small demo — toggle them
          // out of view while the enterprise plan is up, restore on "Back to demo".
          alsoHide: [panels, pertHost],
          build: (bigHost) => {
            const proj = genGanttProject(1000);
            const big = new Gantt(bigHost, {
              projectStart: proj.T0,
              preset: { ...WEEK_AND_DAY, pxPerUnit: 12 },
              columns: DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
              tasks: proj.tasks,
              dependencies: proj.dependencies,
            });
            // Baseline overlay: snapshot the plan, slip a couple of tasks, show it.
            try {
              big.captureBaseline('plan', 'As-planned');
              big.updateTaskSpan('l10', { start: proj.T0 + 24 * DAY, end: proj.T0 + 30 * DAY });
              big.showBaseline('plan');
            } catch (_) {}
          },
        });

        statusEl.textContent = 'Scheduling mode: ASAP (forward from project start)';

        h.appendChild(el('div', { class: 'g-note', text: 'A full enterprise plan: rich grid (WBS · effort · predecessors/successors · rolled-up %), summary roll-up markers, FS/SS deps, a split Frontend task, deadline/constraint indicators, baseline + multi-baseline compare, status line, and project marker lines. Below the chart, the Resource Histogram (capacity vs allocation, sharing the chart axis) sits beside the Resource Utilization grid. The toolbar drives undo/redo (STM), an explicit ASAP/ALAP reschedule, split/join, a PERT network-diagram view, utilization drill-down, and exports to CSV / Excel / PNG / PDF / ICS / MS-Project plus Print (unified Export menu floats top-right of the chart).' }));
      }, { block: true }));

      /* — Calendar: events on a date, week view — */
      /* — Calendar: full featureset —
         View switcher (day/week/month/year/agenda/resource/timeline), an
         RRULE-string recurring event, undo/redo, timezone, ICS/Excel/print
         export, categories + resources. */
    },
    { wide: true },
  ),
);

main.appendChild(
  section(
    'calendar',
    'Calendar',
    'A full calendar — day/week/month/year/agenda/resource/timeline views, RRULE recurrence, timezones, undo/redo, category & resource filtering, and ICS/Excel/print export.',
    (grid) => {
      grid.appendChild(card('Calendar — views · RRULE · timezone · undo/redo · export', (h) => {
        const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.5rem;width:100%' });
        const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.4rem;flex-wrap:wrap;align-items:center' });
        const host = el('div', { style: 'height:var(--g-page-host);width:100%' });
        wrap.appendChild(bar); wrap.appendChild(host); h.appendChild(wrap);
        const today = new Date();
        const Y = today.getFullYear(), M = today.getMonth(), D = today.getDate();
        const at = (off, hr, mn = 0) => new Date(Y, M, D + off, hr, mn);
        const cal = new Calendar(host, {
          date: today,
          view: 'week',
          weekStart: 1,
          dayStartHour: 7,
          dayEndHour: 20,
          timeZone: 'America/New_York',
          locale: 'en-US',
          categories: [
            { id: 'work', name: 'Work', color: 'data-1' },
            { id: 'personal', name: 'Personal', color: 'data-2' },
            { id: 'travel', name: 'Travel', color: 'data-3' },
            { id: 'health', name: 'Health', color: 'data-4' },
          ],
          resources: [
            { id: 'a', name: 'Alice' },
            { id: 'b', name: 'Bob' },
          ],
          events: [
            // RRULE-string recurrence (Mon/Wed/Fri) — proves string interop.
            { id: 1, title: 'Team standup', start: at(0, 9, 0), end: at(0, 9, 30), categoryId: 'work',
              resourceId: 'a', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' },
            { id: 2, title: 'Design review', start: at(0, 11, 0), end: at(0, 12, 30), categoryId: 'work', resourceId: 'b' },
            { id: 3, title: 'Lunch w/ Sam', start: at(1, 12, 30), end: at(1, 13, 30), categoryId: 'personal', resourceId: 'a' },
            { id: 4, title: 'Sprint planning', start: at(2, 14, 0), end: at(2, 16, 0), categoryId: 'work', resourceId: 'b' },
            { id: 5, title: 'Gym', start: at(0, 18, 0), end: at(0, 19, 0), categoryId: 'health', resourceId: 'a',
              recurrence: { freq: 'daily', interval: 2, count: 6 } },
            { id: 6, title: 'Conference', start: at(3, 0, 0), end: at(4, 23, 59), categoryId: 'travel', resourceId: 'b', allDay: true },
          ],
        });
        const btn = (label, onClick) => {
          const b = el('button', { class: 'jects-btn jects-btn--sm', text: label });
          b.addEventListener('click', () => { try { onClick(); } catch (e) { console.warn('CAL-DEMO feature failed:', e && e.message); } });
          bar.appendChild(b);
          return b;
        };
        // The calendar renders its own view switcher (day…timeline) in its chrome;
        // these toolbar buttons add the new non-chrome features.
        const undo = btn('Undo', () => { cal.undo(); sync(); });
        const redo = btn('Redo', () => { cal.redo(); sync(); });
        const sync = () => { undo.disabled = !cal.canUndo(); redo.disabled = !cal.canRedo(); };
        sync();
        // ICS / Excel / Print collapsed into one accessible "Export ▾" menu.
        exportMenu(bar, [
          { label: 'ICS', onClick: () => cal.exportICS('calendar.ics') },
          { label: 'Excel', onClick: () => cal.exportExcel('calendar.xls') },
          { label: 'Print', onClick: () => cal.print() },
        ]);
        wrap.appendChild(el('div', { class: 'g-note', text: 'Switch views (incl. the new timeline), undo/redo edits, and export to ICS/Excel/print. The standup uses an RRULE string (FREQ=WEEKLY;BYDAY=MO,WE,FR); events render in the America/New_York timezone.' }));
      }, { block: true }));

    },
    { wide: true },
  ),
);

main.appendChild(
  section(
    'kanban',
    'Kanban',
    'A TaskBoard — columns + swimlanes, WIP limits, rich cards (cover/tags/assignee/attachments/comments/votes/links), drag-and-drop, undo/redo, sort, filter and export.',
    (grid) => {
      /* — Kanban (TaskBoard): columns + cards — */
      grid.appendChild(card('Kanban board — rich cards, WIP + swimlanes, undo/sort/filter/export', (h) => {
        const host = el('div', { style: 'height:var(--g-page-host);width:100%' });
        // Inline SVG cover so the banner renders with no network fetch (gallery
        // is served static / headless). Two tints keyed off --jects-data ramps.
        const cover = (a, b) =>
          'data:image/svg+xml;utf8,' +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="96">` +
              `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
              `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>` +
              `</linearGradient></defs><rect width="280" height="96" fill="url(#g)"/></svg>`,
          );

        h.appendChild(host);
        const board = new TaskBoard(host, {
          // Built-in toolbar gives the search box + a sort <select> + filter chips.
          toolbar: true,
          searchPlaceholder: 'Search cards…',
          // — Enterprise toggles, all real TaskBoardConfig options —
          undoRedo: true, // board.undo()/redo()/canUndo()/canRedo() + Ctrl+Z/Y
          sortable: true, // toolbar sort <select> + setSortField()/getSortField()
          sortField: 'order', // start in manual drag order
          // Filter predicates (KEEP === true) — render as toolbar chips + drive
          // toggleFilter()/setFilters()/getActiveFilters().
          filters: [
            { id: 'mine', label: 'Assignee: KM', test: (c) => c.assignee === 'KM' },
            { id: 'voted', label: 'Voted', test: (c) => !!(c.votes && c.votes.voted) },
            { id: 'p1', label: 'High priority', test: (c) => (c.tags || []).some((t) => t.text === 'p1') },
          ],
          // Remote sync is available but needs a live server, so we stay on the
          // in-memory seed here. To go remote you'd pass either:
          //   dataProvider: new AjaxDataProvider({ url: '/api/cards' })
          //   // or simply: syncUrl: '/api/cards', wsUrl: 'wss://…'
          columns: [
            { id: 'backlog', title: 'Backlog', color: 1 },
            { id: 'todo', title: 'To Do', color: 2 },
            { id: 'doing', title: 'In Progress', color: 3, limit: 3 }, // WIP limit (soft)
            { id: 'review', title: 'Review', color: 4, limit: 2, strictLimit: true }, // WIP (hard veto)
            { id: 'done', title: 'Done', color: 5 },
          ],
          // Two swimlanes banding across every column.
          lanes: [
            { id: 'fe', title: 'Frontend' },
            { id: 'be', title: 'Backend' },
          ],
          // Rich seed cards: cover / tags / avatar / assignee / progress /
          // attachments / comments / votes / links / due / custom priority.
          cards: [
            {
              id: 1, column: 'backlog', lane: 'fe', order: 0, priority: 2,
              title: 'Design tokens audit', description: 'Verify OKLCH ramps render token-pure.',
              cover: cover('#6d8bd8', '#a7c0f0'),
              tags: [{ text: 'design', color: 1 }, { text: 'p2', color: 4 }],
              avatar: 'KM', assignee: 'KM', progress: 10, due: '2026-07-10',
              attachments: [{ name: 'spec.pdf', size: 184320 }],
              comments: [{ author: 'AB', text: 'Ramp 5 looks off in dark mode.', time: '2026-06-20' }],
              votes: { count: 3, voted: false }, links: [6],
            },
            {
              id: 2, column: 'todo', lane: 'fe', order: 0, priority: 1,
              title: 'Drag-and-drop polish', description: 'Auto-scroll + multiselect refinements.',
              cover: cover('#3fa796', '#9fd9cf'),
              tags: [{ text: 'feature', color: 2 }],
              avatar: 'KM', assignee: 'KM', progress: 0, due: '2026-06-30',
              votes: { count: 5, voted: true }, links: [3, 4],
              attachments: [{ name: 'flow.mp4', size: 2400000 }, { name: 'notes.txt', size: 1024 }],
            },
            {
              id: 3, column: 'doing', lane: 'be', order: 0, priority: 3,
              title: 'WIP limit enforcement', description: 'Soft flag + strict veto.',
              tags: [{ text: 'core', color: 3 }, { text: 'p1', color: 6 }],
              avatar: 'AB', assignee: 'AB', progress: 60, due: '2026-07-05',
              comments: [
                { author: 'KM', text: 'Strict mode should reject the drop.', time: '2026-06-22' },
                { author: 'AB', text: 'Done — emits limitReject.', time: '2026-06-23' },
              ],
              votes: { count: 1, voted: false },
            },
            {
              id: 4, column: 'doing', lane: 'be', order: 1, priority: 1,
              title: 'Inline quick-edit', description: 'Rename a card in place.',
              avatar: 'KM', assignee: 'KM', progress: 30, due: '2026-07-15',
              votes: { count: 0, voted: false },
            },
            {
              id: 5, column: 'review', lane: 'be', order: 0, priority: 3,
              title: 'A11y axe pass', description: 'Keyboard move + live region.',
              cover: cover('#c8783c', '#f0c79a'),
              tags: [{ text: 'a11y', color: 5 }, { text: 'p1', color: 6 }],
              avatar: 'AB', assignee: 'AB', progress: 90, due: '2026-06-28',
              attachments: [{ name: 'axe-report.html', size: 51200 }],
              votes: { count: 8, voted: false }, links: [3],
            },
            {
              id: 6, column: 'done', lane: 'be', order: 0, priority: 1,
              title: 'Token-pure CSS', description: 'No hard-coded colors.',
              tags: [{ text: 'chore', color: 7 }],
              progress: 100, due: '2026-06-10',
              bodyItems: [{ text: 'Merged in #142' }],
              comments: [{ author: 'KM', text: 'LGTM 🎉', time: '2026-06-11' }],
              votes: { count: 2, voted: false },
            },
          ],
        });

        // ── Gallery host toolbar — drives the public API directly ──────────
        const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;margin-bottom:.5rem' });
        const status = el('span', { class: 'g-note', style: 'margin-left:.5rem' });
        const tb = (text, onClick, variant = 'secondary') => {
          const b = new Button(bar, { text, variant, size: 'sm' });
          b.el.addEventListener('click', onClick);
          return b;
        };

        // Sort cycle: order → priority → title → votes → due (real setSortField).
        const SORTS = ['order', 'priority', 'title', 'votes', 'due'];
        let si = 0;
        const sortBtn = tb('Sort: order', () => {
          si = (si + 1) % SORTS.length;
          try {
            board.setSortField(SORTS[si]);
            sortBtn.el.textContent = 'Sort: ' + board.getSortField();
          } catch (e) { console.warn('KANBAN-DEMO feature failed:', e && e.message); }
        }, 'outline');

        // Filter chips (programmatic) mirroring the declared filters.
        const filterBtn = (id, label) =>
          tb(label, (ev) => {
            try {
              board.toggleFilter(id);
              ev.currentTarget?.setAttribute?.('aria-pressed', String(board.getActiveFilters().includes(id)));
            } catch (e) { console.warn('KANBAN-DEMO feature failed:', e && e.message); }
          }, 'ghost');
        filterBtn('mine', 'Filter: KM');
        filterBtn('voted', 'Filter: voted');

        // Vote toggle on a representative card (recorded on the undo stack).
        tb('Vote ↑ (card 1)', () => {
          try { board.toggleVote(1); } catch (e) { console.warn('KANBAN-DEMO feature failed:', e && e.message); }
        }, 'ghost');

        // Undo / redo wired to canUndo()/canRedo() + the historyChange event.
        const undoBtn = tb('Undo', () => { try { board.undo(); } catch (e) { console.warn('KANBAN-DEMO feature failed:', e && e.message); } });
        const redoBtn = tb('Redo', () => { try { board.redo(); } catch (e) { console.warn('KANBAN-DEMO feature failed:', e && e.message); } });
        const syncHistory = () => {
          try {
            undoBtn.el.disabled = !board.canUndo();
            redoBtn.el.disabled = !board.canRedo();
          } catch (e) { console.warn('KANBAN-DEMO feature failed:', e && e.message); }
        };
        try { board.on('historyChange', syncHistory); } catch (e) { console.warn('KANBAN-DEMO feature failed:', e && e.message); }
        syncHistory();

        // Export — board.export({ format }) returns a string (json / csv).
        // JSON / CSV collapsed into one accessible "Export ▾" menu.
        const exportItem = (fmt) => ({
          label: fmt.toUpperCase(),
          onClick: () => {
            try {
              const out = board.export({ format: fmt });
              status.textContent = fmt.toUpperCase() + ' export: ' + out.length + ' chars';
              console.log('[KANBAN-DEMO] export ' + fmt + ':', out.slice(0, 120));
            } catch (e) { console.warn('KANBAN-DEMO feature failed:', e && e.message); }
          },
        });
        exportMenu(bar, [exportItem('json'), exportItem('csv')]);

        // ── Enterprise scale: a 500-card backlog across columns × swimlanes. ──
        enterpriseSwap(bar, host, {
          key: 'kanban',
          count: '500 cards',
          status: (m) => { status.textContent = m; },
          build: (bigHost) => {
            const columns = [
              { id: 'backlog', title: 'Backlog', color: 1 },
              { id: 'todo', title: 'To Do', color: 2 },
              { id: 'doing', title: 'In Progress', color: 3 },
              { id: 'review', title: 'Review', color: 4 },
              { id: 'done', title: 'Done', color: 5 },
            ];
            const lanes = [{ id: 'fe', title: 'Frontend' }, { id: 'be', title: 'Backend' }];
            const cards = genKanbanCards(500, columns.map((c) => c.id), lanes.map((l) => l.id));
            new TaskBoard(bigHost, {
              toolbar: true,
              searchPlaceholder: 'Search cards…',
              sortable: true,
              sortField: 'order',
              columns,
              lanes,
              cards,
            });
          },
        });

        bar.appendChild(status);
        // Toolbar sits above the board within the card body.
        h.insertBefore(bar, h.firstChild);
      }, { block: true }));
    },
    { wide: true },
  ),
);

/* ── #realtime — live multi-user collaboration (simulated remote provider) ──
   A TaskBoard wired to a MOCK TaskBoardDataProvider through the board's REAL
   `dataProvider` surface: the board calls `load()` for the seed, then
   `subscribe(onRemote)` and hands us the callback that pushes remote ops into
   the live store. When "Live" is on, the provider emits a simulated remote
   CardSyncOp (`add` / `update`=move|reassign|relabel|progress / `remove`) on a
   jittered 1.5–2.5 s timer — exactly as if other users were collaborating —
   and the board applies + re-renders it (its `applyRemoteOp` path). Bounded to
   MIN..MAX cards so it runs indefinitely. Pause clears the timer (real stop). */
main.appendChild(
  section(
    'realtime',
    'Live collaboration',
    "A TaskBoard wired to a simulated multi-user data provider. Press Start — the board updates on its own (cards move, arrive, get reassigned and relabelled, as if teammates were collaborating) through the board's real dataProvider.subscribe() surface. Every remote event is logged to the activity feed. Pause genuinely stops the stream.",
    (grid) => {
      grid.appendChild(card('Real-time board — simulated remote provider via subscribe()', (h) => {
        const COLUMNS = [
          { id: 'backlog', title: 'Backlog', color: 1 },
          { id: 'todo', title: 'To Do', color: 2 },
          { id: 'doing', title: 'In Progress', color: 3, limit: 5 },
          { id: 'review', title: 'Review', color: 4 },
          { id: 'done', title: 'Done', color: 5 },
        ];
        const COL_TITLE = Object.fromEntries(COLUMNS.map((c) => [c.id, c.title || c.id]));
        const TEAM = ['Alex', 'Brook', 'Casey', 'Devon', 'Erin'];
        const INITIALS = { Alex: 'AX', Brook: 'BR', Casey: 'CY', Devon: 'DV', Erin: 'ER' };
        const LABELS = [
          { text: 'feature', color: 2 }, { text: 'bug', color: 6 }, { text: 'chore', color: 7 },
          { text: 'p1', color: 4 }, { text: 'perf', color: 3 }, { text: 'design', color: 1 },
        ];
        const VERBS = ['Implement', 'Fix', 'Refactor', 'Polish', 'Wire up', 'Tune', 'Audit', 'Ship', 'Document'];
        const NOUNS = ['search', 'flaky test', 'data store', 'drag handles', 'webhooks', 'cache layer',
          'a11y pass', 'export', 'onboarding', 'rate limiter', 'theme tokens'];
        const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
        const newTitle = () => rand(VERBS) + ' ' + rand(NOUNS);

        // Bounds — keep the board between MIN and MAX cards so it can stream forever.
        const MIN_CARDS = 6, MAX_CARDS = 16;
        let nextId = 1000; // ids for remotely-arriving cards

        // Seed card set (returned by the provider's load()).
        const seed = [];
        for (let i = 0; i < 9; i++) {
          const who = rand(TEAM);
          seed.push({
            id: i + 1, column: COLUMNS[i % COLUMNS.length].id, order: i,
            title: newTitle(), assignee: who, avatar: INITIALS[who],
            tags: [rand(LABELS)], progress: (i * 17) % 101,
          });
        }

        /* The MOCK real-time provider. Implements the TaskBoardDataProvider
           contract (load / sync / subscribe). The board owns the wiring; we just
           emit ops into `onRemote`. `start()`/`stop()` gate the timer. A separate
           `onActivity` callback feeds the human-readable activity log. */
        const provider = {
          board: null,
          onRemote: null,
          onActivity: null,
          timer: null,
          load() { return Promise.resolve(seed.map((c) => ({ ...c }))); },
          sync() { return Promise.resolve(); }, // local drags would POST here; no-op for the sim
          subscribe(onRemote) {
            this.onRemote = onRemote;
            return () => { this.onRemote = null; this.stop(); };
          },
          start() {
            if (this.timer) return;
            const tick = () => { this.emitOne(); this.timer = setTimeout(tick, 1500 + Math.random() * 1000); };
            this.timer = setTimeout(tick, 1500 + Math.random() * 1000);
          },
          stop() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } },
          log(msg) { if (this.onActivity) this.onActivity(msg); },
          emitOne() {
            if (!this.onRemote || !this.board) return;
            const cards = this.board.store.toArray();
            const actor = rand(TEAM);
            // Pick an action that respects the card-count bounds.
            let action;
            if (cards.length <= MIN_CARDS) action = Math.random() < 0.45 ? 'add' : 'move';
            else if (cards.length >= MAX_CARDS) action = Math.random() < 0.5 ? 'remove' : 'move';
            else { const r = Math.random(); action = r < 0.55 ? 'move' : r < 0.78 ? 'edit' : r < 0.9 ? 'add' : 'remove'; }
            if (!cards.length) action = 'add';

            if (action === 'add') {
              const id = ++nextId;
              const who = rand(TEAM);
              const col = rand(COLUMNS);
              const card = {
                id, column: col.id, order: Date.now(), title: newTitle(),
                assignee: who, avatar: INITIALS[who], tags: [rand(LABELS)], progress: 0,
              };
              this.onRemote({ action: 'add', id, card });
              this.log(actor + ' added “' + card.title + '” to ' + col.title);
              return;
            }
            const t = rand(cards);
            const name = t.title || ('Card ' + t.id);
            if (action === 'remove') {
              this.onRemote({ action: 'remove', id: t.id });
              this.log(actor + ' archived “' + name + '”');
              return;
            }
            if (action === 'edit') {
              const kind = rand(['assignee', 'label', 'progress']);
              if (kind === 'assignee') {
                const who = rand(TEAM);
                this.onRemote({ action: 'update', id: t.id, card: { assignee: who, avatar: INITIALS[who] } });
                this.log(actor + ' assigned “' + name + '” to ' + who);
              } else if (kind === 'label') {
                const lab = rand(LABELS);
                this.onRemote({ action: 'update', id: t.id, card: { tags: [lab] } });
                this.log(actor + ' labelled “' + name + '” ' + lab.text);
              } else {
                const p = Math.min(100, (t.progress || 0) + 10 + Math.floor(Math.random() * 30));
                this.onRemote({ action: 'update', id: t.id, card: { progress: p } });
                this.log(actor + ' moved “' + name + '” to ' + p + '%');
              }
              return;
            }
            // move: send the card to a different column
            const to = rand(COLUMNS.filter((c) => c.id !== t.column)) || rand(COLUMNS);
            this.onRemote({ action: 'update', id: t.id, card: { column: to.id, order: Date.now() } });
            this.log(actor + ' moved “' + name + '” to ' + to.title);
          },
        };

        /* ── chrome: Live indicator + Start/Pause + per-column counts ── */
        const bar = el('div', { class: 'g-host-toolbar g-rt-bar' });
        const dot = el('span', { class: 'g-rt-dot', 'aria-hidden': 'true' });
        const indText = el('span', { class: 'g-rt-indicator-text', text: 'Paused' });
        const indicator = el('span', { class: 'g-rt-indicator', 'data-rt-live': 'false', role: 'status' }, [dot, indText]);
        bar.appendChild(indicator);
        const toggleBtn = new Button(bar, { text: 'Start', variant: 'primary', size: 'sm' });
        toggleBtn.el.setAttribute('data-rt-toggle', '');
        const counts = el('span', { class: 'g-note g-rt-counts', 'data-rt-counts': '' });
        bar.appendChild(counts);

        /* ── board host + activity feed, side by side ── */
        const host = el('div', { style: 'height:var(--g-page-host);width:100%' });
        const feed = el('ul', { class: 'g-rt-feed', 'data-rt-feed': '', 'aria-label': 'Activity feed' });
        const feedWrap = el('div', { class: 'g-rt-feedwrap' }, [
          el('div', { class: 'g-rt-feedhd', text: 'Activity' }),
          feed,
        ]);
        const layout = el('div', { class: 'g-rt-layout' }, [
          el('div', { class: 'g-rt-boardwrap' }, [host]),
          feedWrap,
        ]);
        h.appendChild(bar);
        h.appendChild(layout);

        // Mount the board with the MOCK provider as its real data source.
        const board = new TaskBoard(host, {
          toolbar: true,
          searchPlaceholder: 'Search cards…',
          columns: COLUMNS,
          dataProvider: provider,
        });
        provider.board = board;

        const rtState = (window.__JECTS_REALTIME__ = window.__JECTS_REALTIME__ || { live: false, events: 0, total: 0, counts: {} });

        function updateCounts() {
          try {
            const arr = board.store.toArray();
            const per = {};
            for (const c of COLUMNS) per[c.id] = 0;
            for (const c of arr) if (per[c.column] != null) per[c.column]++;
            counts.textContent = COLUMNS.map((c) => COL_TITLE[c.id] + ' ' + per[c.id]).join(' · ') + ' · ' + arr.length + ' cards';
            rtState.counts = per;
            rtState.total = arr.length;
          } catch (_) { /* store not ready yet */ }
        }

        let feedCount = 0;
        provider.onActivity = (msg) => {
          feedCount++;
          rtState.events = feedCount;
          const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const li = el('li', { class: 'g-rt-event' }, [
            el('span', { class: 'g-rt-event-time', text: time }),
            el('span', { class: 'g-rt-event-msg', text: msg }),
          ]);
          feed.insertBefore(li, feed.firstChild);
          while (feed.childElementCount > 40) feed.removeChild(feed.lastChild);
          updateCounts();
        };

        let live = false;
        const setLive = (on) => {
          live = on;
          rtState.live = on;
          indicator.setAttribute('data-rt-live', String(on));
          indText.textContent = on ? 'Live' : 'Paused';
          toggleBtn.el.textContent = on ? 'Pause' : 'Start';
          if (on) provider.start(); else provider.stop();
        };
        toggleBtn.el.addEventListener('click', () => setLive(!live));

        // Seed counts once the async load() has populated the store.
        setTimeout(updateCounts, 60);
        setTimeout(updateCounts, 450);
      }, { block: true }));
    },
    { wide: true },
  ),
);

/* ── Wave 5 components ──────────────────────────────────────────────────── */
main.appendChild(
  section(
    'diagram',
    'Diagram',
    'A no-code diagram editor — flowchart/org/mind/PERT modes, custom/HTML/image shapes, orthogonal A* routing, auto-layout, swimlanes, groups, a properties panel, undo/redo and export.',
    (grid) => {
      /* — Diagram: a small flowchart with shapes + connectors — */
      grid.appendChild(card('Diagram (full editor)', (h) => {
        /* Helper: never let an optional feature kill the demo. */
        const warn = (label, e) => console.warn('DIAGRAM-DEMO feature failed:', label, e && e.message);

        /* — Custom toolbar that drives the public DiagramApi — */
        const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.4rem;flex-wrap:wrap;align-items:center' });
        h.appendChild(bar);

        const host = el('div', { style: 'height:var(--g-page-host);width:100%' });
        h.appendChild(host);

        /* A tiny inline SVG data-URI so the `image` shape resolves headless. */
        const imgHref =
          'data:image/svg+xml;utf8,' +
          encodeURIComponent(
            "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='80'>" +
            "<rect width='120' height='80' rx='8' fill='%2306b6d4'/>" +
            "<circle cx='60' cy='34' r='18' fill='white'/>" +
            "<rect x='30' y='56' width='60' height='10' rx='5' fill='white'/></svg>",
          );

        const diagram = new Diagram(host, {
          mode: 'flowchart',
          editable: true,
          grid: true,
          snap: 8,
          selectionMode: 'multi',
          shapes: [
            { id: 'start', type: 'start', x: 180, y: 20, w: 140, h: 56, text: 'Start', lane: 'lane-intake' },
            { id: 'input', type: 'data', x: 180, y: 120, w: 140, h: 60, text: 'Get request', lane: 'lane-intake' },
            { id: 'check', type: 'decision', x: 170, y: 230, w: 160, h: 90, text: 'Valid?', lane: 'lane-process' },
            { id: 'ok', type: 'process', x: 40, y: 370, w: 150, h: 60, text: 'Process order', lane: 'lane-process' },
            { id: 'err', type: 'process', x: 330, y: 370, w: 150, h: 60, text: 'Reject', lane: 'lane-process' },
            { id: 'end', type: 'end', x: 180, y: 470, w: 140, h: 56, text: 'Done', lane: 'lane-process' },
            /* HTML (foreignObject) shape via `data.html`. */
            {
              id: 'note', type: 'rect', x: 540, y: 30, w: 220, h: 96,
              data: { html: "<div style='font:13px system-ui;padding:8px;color:#0f172a'><b>SLA note</b><br/>Reject after 3 retries. Editable HTML body.</div>" },
            },
            /* Image shape via `type:'image'` + `data.href`. */
            { id: 'logo', type: 'image', x: 580, y: 150, w: 120, h: 80, data: { href: imgHref } },
          ],
          connectors: [
            { id: 'c1', from: { shape: 'start' }, to: { shape: 'input' }, kind: 'orthogonal', arrows: { end: 'arrow' } },
            { id: 'c2', from: { shape: 'input' }, to: { shape: 'check' }, kind: 'orthogonal' },
            { id: 'c3', from: { shape: 'check' }, to: { shape: 'ok' }, kind: 'orthogonal', label: 'Yes' },
            { id: 'c4', from: { shape: 'check' }, to: { shape: 'err' }, kind: 'orthogonal', label: 'No' },
            { id: 'c5', from: { shape: 'ok' }, to: { shape: 'end' }, kind: 'orthogonal' },
          ],
          swimlanes: [
            { id: 'lane-intake', title: 'Intake', orientation: 'horizontal', x: 0, y: 0, w: 520, h: 200, order: 0 },
            { id: 'lane-process', title: 'Processing', orientation: 'horizontal', x: 0, y: 200, w: 520, h: 360, order: 1 },
          ],
        });

        /* — Register a custom shape outline + add an instance — */
        try {
          diagram.engine.registerShape({
            key: 'badge',
            defaultSize: { width: 120, height: 80 },
            defaultStyle: { fill: 'primary', stroke: 'border', strokeWidth: 2 },
            // Normalized 0..w / 0..h outline (a chevron/shield badge).
            outline: ({ width: w, height: hh }) =>
              `M ${w * 0.5} 0 L ${w} ${hh * 0.3} L ${w} ${hh * 0.75} ` +
              `L ${w * 0.5} ${hh} L 0 ${hh * 0.75} L 0 ${hh * 0.3} Z`,
          });
          diagram.addShape({
            id: 'badge1', type: 'custom', shapeDef: 'badge',
            x: 560, y: 270, w: 120, h: 80, text: 'Custom',
            style: { fill: 'accent', stroke: 'border', strokeWidth: 2, textColor: 'accent-foreground' },
          });
        } catch (e) { warn('registerShape', e); }

        /* — Toolbar buttons that exercise the API — */
        const tb = (text, onClick, variant = 'secondary') => {
          const b = new Button(bar, { text, variant, size: 'sm' });
          b.el.addEventListener('click', (ev) => { try { onClick(ev); } catch (e) { warn(text, e); } });
          return b;
        };

        const undoBtn = tb('Undo', () => { diagram.undo(); sync(); }, 'ghost');
        const redoBtn = tb('Redo', () => { diagram.redo(); sync(); }, 'ghost');
        function sync() {
          try {
            undoBtn.el.disabled = !diagram.canUndo();
            redoBtn.el.disabled = !diagram.canRedo();
          } catch (e) { warn('sync', e); }
        }

        /* Mode switcher (flowchart / org / mind / PERT). */
        const modes = ['flowchart', 'orgchart', 'mindmap', 'pert'];
        let modeIx = 0;
        tb('Mode: flowchart', (ev) => {
          modeIx = (modeIx + 1) % modes.length;
          diagram.setMode(modes[modeIx]);
          ev.currentTarget && (ev.currentTarget.textContent = 'Mode: ' + modes[modeIx]);
          sync();
        }, 'outline');

        /* Auto-layout: orthogonal tidy-tree, then radial on the next press. */
        let layoutRadial = false;
        tb('Auto-layout', () => {
          diagram.autoLayout(layoutRadial ? 'radial' : 'orthogonal', { nodeSpacing: 40, rankSpacing: 80, direction: 'down' });
          layoutRadial = !layoutRadial;
          diagram.fitToView();
          sync();
        }, 'outline');

        /* Swimlanes: add an alternating lane via the API. */
        let laneN = 3;
        tb('Add lane', () => {
          diagram.addSwimlane({
            id: 'lane-' + laneN, title: 'Lane ' + laneN, orientation: 'vertical',
            x: 540 + (laneN - 3) * 240, y: 270, w: 220, h: 240, order: laneN,
          });
          laneN += 1;
          sync();
        }, 'outline');

        /* Group / ungroup: select two shapes, group them, then dissolve. */
        let groupId = null;
        tb('Group', () => {
          diagram.select(['ok', 'err']);
          groupId = diagram.group(['ok', 'err']) || null;
          sync();
        }, 'outline');
        tb('Ungroup', () => {
          if (groupId) { diagram.ungroup(groupId); groupId = null; }
          sync();
        }, 'outline');

        /* Properties: recolor the current selection (fill + stroke + text). */
        tb('Recolor', () => {
          const sel = diagram.getSelection();
          const ids = sel.length ? sel : ['check'];
          for (const id of ids) {
            diagram.updateShape(id, { style: { fill: 'accent', stroke: 'primary', strokeWidth: 3, textColor: 'accent-foreground', fontSize: 14 } });
          }
          sync();
        }, 'outline');

        /* Fit-to-view. */
        tb('Fit', () => { diagram.fitToView(); }, 'ghost');

        /* Export JSON via the documented helper (+ downloadBlob). */
        tb('Export JSON', () => {
          const json = documentToJson(diagram.toJSON());
          try { downloadBlob(json, 'diagram.json', 'application/json'); } catch (e) { warn('downloadBlob', e); }
          console.info('DIAGRAM-DEMO export bytes:', json.length);
        }, 'ghost');

        /* ── Enterprise scale: a 200-node org/flow graph, auto-laid-out. ── */
        enterpriseSwap(bar, host, {
          key: 'diagram',
          count: '200 nodes (auto-layout)',
          build: (bigHost) => {
            const g = genDiagramGraph(200);
            const big = new Diagram(bigHost, {
              mode: 'flowchart',
              editable: true,
              grid: true,
              snap: 8,
              shapes: g.shapes,
              connectors: g.connectors,
            });
            try { big.autoLayout('orthogonal', { nodeSpacing: 40, rankSpacing: 80, direction: 'down' }); } catch (_) {}
            try { big.fitToView(); } catch (_) {}
          },
        });

        /* Keep undo/redo state in sync with every model change + selection. */
        try { diagram.on('change', sync); } catch (e) { warn('on change', e); }
        try { diagram.on('select', sync); } catch (e) { warn('on select', e); }
        sync();

        h.appendChild(el('div', { class: 'g-note', text: 'A full no-code editor: drag shapes, draw connectors from edges, and pick from the left rail. The toolbar above drives undo/redo, mode switching (flowchart/org/mind/PERT), A*-routed auto-layout (orthogonal + radial), swimlanes, grouping, property styling, and JSON export. The built-in toolbar adds align/distribute, copy/apply style, and PNG/PDF export. Includes an HTML body, an image node, and a registered custom shape.' }));
      }, { block: true }));

    },
    { wide: true },
  ),
);

main.appendChild(
  section(
    'todo',
    'To-Do',
    'An enterprise task manager (Asana / ClickUp / Monday-class): a configurable workflow with List + Board views, sort · group-by · multi-criteria filter · search, rich tasks (assignees, tags, custom fields, due-status, recurrence), a detail editor, multi-select + bulk actions, undo/redo, and JSON/CSV export.',
    (grid) => {
      /* — ToDo: enterprise task manager (5 views · collaboration · timer · deps) — */
      grid.appendChild(card('Task manager — List/Board/Calendar/Timeline/Table · comments · timer · deps', (h) => {
        const host = el('div', { style: 'height:var(--g-page-host);width:100%' });
        h.appendChild(host);
        new TodoList(host, {
          // A real 4-stage workflow with per-column WIP limits (Board enforces them).
          statuses: [
            { id: 'todo', label: 'To do', color: 'var(--jects-data-1)', isDone: false },
            { id: 'doing', label: 'In progress', color: 'var(--jects-data-2)', isDone: false, wipLimit: 2 },
            { id: 'review', label: 'In review', color: 'var(--jects-data-3)', isDone: false, wipLimit: 3 },
            { id: 'done', label: 'Done', color: 'var(--jects-data-4)', isDone: true },
          ],
          assignees: ['KM', 'Alex', 'Sam', 'Jo'],
          customFieldDefs: [
            { id: 'sprint', label: 'Sprint', type: 'select', options: ['S-24', 'S-25', 'S-26'], showOnRow: true },
            { id: 'points', label: 'Story points', type: 'number', showOnRow: true },
          ],
          // Switch among all 5 views via the toolbar; Board can split into swimlanes.
          view: 'list',
          groupBy: 'status',
          boardSwimlane: 'assignee',
          tableColumns: [
            { field: 'title', width: 220 }, { field: 'status' }, { field: 'priority' },
            { field: 'assignees' }, { field: 'due' }, { field: 'cf:points', label: 'Pts' },
          ],
          sortBy: [{ field: 'priority', dir: 'desc' }, { field: 'due', dir: 'asc' }],
          savedFilters: [
            { id: 'mine', name: 'My high-priority', filters: { assignees: ['KM'], priority: ['high'] } },
            { id: 'duesoon', name: 'Due soon', filters: { due: 'soon' } },
          ],
          // detailPanel / selectable / history / reorderable all default on.
          now: () => new Date(2026, 5, 25),
          tasks: [
            {
              id: 'launch', title: 'Launch checklist', status: 'doing', priority: 'high',
              startDate: '2026-06-22', due: '2026-06-30',
              assignees: ['KM'], tags: [{ text: 'release', color: 'var(--jects-cmyk-magenta)' }],
              customFields: { sprint: 'S-25', points: 8 },
              estimate: 16, timeSpent: 6,
              comments: [
                { id: 'c1', author: 'KM', text: 'Pinged @Alex about the QA gate', createdAt: Date.UTC(2026, 5, 24, 9), mentions: ['Alex'] },
                { id: 'c2', author: 'Alex', text: 'On it — blocked by the signup fix', createdAt: Date.UTC(2026, 5, 24, 10) },
              ],
              attachments: [{ id: 'a1', name: 'launch-plan.pdf', type: 'application/pdf', size: 248000 }],
              children: [
                { id: 'copy', title: 'Finalize landing copy', status: 'done', assignees: ['Sam'], startDate: '2026-06-22', due: '2026-06-24' },
                { id: 'qa', title: 'QA the signup flow', status: 'review', startDate: '2026-06-25', due: '2026-06-27', priority: 'high', assignees: ['Alex'], dependencies: { blockedBy: ['bugfix'] } },
                {
                  id: 'assets', title: 'Marketing assets', status: 'doing', assignees: ['Jo'], startDate: '2026-06-24', due: '2026-06-29',
                  children: [
                    { id: 'og', title: 'OG image', status: 'done' },
                    { id: 'video', title: 'Demo video', status: 'todo', priority: 'medium', due: '2026-06-30' },
                  ],
                },
              ],
            },
            { id: 'ship', title: 'v1.0 release', status: 'todo', milestone: true, due: '2026-07-01', priority: 'high', assignees: ['KM'] },
            { id: 'standup', title: 'Daily standup notes', status: 'todo', due: '2026-06-25', priority: 'low',
              assignees: ['KM'], recurrence: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', tags: [{ text: 'ritual' }] },
            { id: 'invoices', title: 'Send invoices', status: 'done', assignees: ['Sam'], customFields: { sprint: 'S-24', points: 3 } },
            { id: 'roadmap', title: 'Draft Q3 roadmap', status: 'todo', startDate: '2026-06-26', due: '2026-07-05', priority: 'medium',
              assignees: ['Jo', 'KM'], tags: [{ text: 'planning', color: 'var(--jects-cmyk-cyan)' }], customFields: { sprint: 'S-26', points: 13 } },
            { id: 'bugfix', title: 'Fix calendar popup z-order', status: 'review', startDate: '2026-06-25', due: '2026-06-26', priority: 'high',
              assignees: ['Alex'], tags: [{ text: 'p1', color: 'var(--jects-cmyk-magenta)' }], customFields: { sprint: 'S-25', points: 2 }, dependencies: { blocks: ['qa'] } },
          ],
        });
        h.appendChild(el('div', { class: 'g-note', text: 'Five views from the toolbar: List (grouped, multi-sort), Board (WIP limits + assignee swimlanes + drag), Calendar (by due date), Timeline (start→due bars with dependency arrows), and a configurable Table. Open any task for inline pickers, comments with @mentions, an activity log, attachments, a start/stop time tracker (estimate vs spent), dependency chains with cycle detection, and custom fields. Multi-select for bulk actions, Ctrl+Z/Y undo, recurring tasks, milestones, saved filters, and JSON/CSV import & export.' }));
      }, { block: true }));

      /* — Booking: date picker + slot grid + reservation form — */
    },
    { wide: true },
  ),
);

main.appendChild(
  section(
    'booking',
    'Booking',
    'An enterprise scheduling widget (Calendly / Acuity / Bryntum-class): multiple services (price · duration · buffers · notice · horizon), per-resource availability rules with blackout dates, group capacity + waitlist, DST-correct timezones with a display selector, recurring series, a month/week overview, manage (reschedule/cancel), undo/redo + multi-select, ICS export and reminders.',
    (grid) => {
      grid.appendChild(card('Scheduling — services · availability · timezone · capacity · manage · ICS', (h) => {
        const host = el('div', { style: 'height:var(--g-page-host);width:100%;overflow:auto' });
        h.appendChild(host);
        const today = new Date(2026, 5, 25); // gallery "now"
        const day = new Date(2026, 5, 29); // Mon 29 Jun 2026 — future weekday → slots open
        new Booking(host, {
          date: day,
          minDate: today,
          timeFormat: '12h',
          locale: 'en-US',
          slotsHeading: 'Choose a time',
          // ── Multiple services (each with its own duration / price / buffers / notice / capacity) ──
          services: [
            { id: 'consult', name: 'Intro consultation', duration: 30, price: 0, description: 'Free 30-minute intro call', bufferAfter: 10, minNotice: 120 },
            { id: 'demo', name: 'Product demo', duration: 60, price: 150, currency: 'USD', description: 'Guided 1:1 product walkthrough', bufferBefore: 5, bufferAfter: 10 },
            { id: 'workshop', name: 'Group workshop', duration: 90, price: 75, currency: 'USD', description: 'Hands-on class — up to 6 seats', capacity: 6, waitlist: true },
          ],
          // ── Two bookable resources (staff) ──
          resources: [
            { id: 'alex', name: 'Alex Rivera' },
            { id: 'sam', name: 'Sam Chen' },
          ],
          // ── Rich availability: per-weekday hours + a blackout + a per-resource override ──
          availability: {
            weekly: {
              1: [{ start: '09:00', end: '17:00' }],
              2: [{ start: '09:00', end: '17:00' }],
              3: [{ start: '09:00', end: '13:00' }],
              4: [{ start: '09:00', end: '17:00' }],
              5: [{ start: '10:00', end: '15:00' }],
            },
            blackouts: ['2026-07-03'],
            perResource: {
              sam: { weekly: { 1: [{ start: '12:00', end: '18:00' }], 4: [{ start: '12:00', end: '18:00' }] } },
            },
          },
          // ── Timezone selector (DST-correct via Intl) ──
          timeZone: 'America/New_York',
          timezones: ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo'],
          // ── Capacity + waitlist + reminders + ICS + manage + overview ──
          waitlist: true,
          reminderLeadMinutes: [1440, 60],
          icsExport: true,
          manageable: true,
          toolbar: true,
          showCalendarView: true,
          bookings: [
            { date: '2026-06-25', time: '10:00' },
            { date: '2026-06-25', time: '13:30' },
            { date: '2026-06-25', time: '14:00' },
          ],
          onBook: (result) => console.log('[gallery] booked:', result),
        });
        h.appendChild(el('div', { class: 'g-note', text: 'Pick a service (price/duration shown) and a staff member, switch the display timezone, then choose an open slot — availability follows per-weekday hours, buffers, advance-notice and blackout dates; full group slots offer a waitlist. The toolbar adds undo/redo and a manage panel to reschedule/cancel; after booking you get an "Add to calendar" (.ics) action. The month overview below mirrors the bookings.' }));
      }, { block: true }));

      /* — Chatbot: seeded conversation + mock streaming onSend — */
    },
    { wide: true },
  ),
);

main.appendChild(
  section(
    'chatbot',
    'Chatbot',
    'An LLM-agnostic chat UI — avatars, names, timestamps, copy + clear actions, suggested replies, and mock streaming Markdown (headings · bold · fenced code · lists).',
    (grid) => {
      grid.appendChild(card('Chatbot (chat UI, mock provider)', (h) => {
        const host = el('div', { style: 'height:var(--g-page-host);width:100%' });
        h.appendChild(host);
        // Inline SVG avatars so the avatars column renders with no network fetch.
        const avatar = (bg, ch) =>
          'data:image/svg+xml;utf8,' +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">` +
              `<rect width="40" height="40" rx="20" fill="${bg}"/>` +
              `<text x="20" y="26" font-family="system-ui" font-size="17" fill="white" text-anchor="middle">${ch}</text></svg>`,
          );
        async function* mockStream(text) {
          // A richer Markdown reply: heading + bold + fenced code block + list.
          const reply = `You said: **${text}**.\n\n### What I can do\n\n- stream token by token\n- render \`markdown\`, including fenced code:\n\n\`\`\`js\nchat.onSend = (t) => provider.stream(t);\n\`\`\`\n\n- show suggested replies`;
          for (const word of reply.split(/(\s+)/)) {
            await new Promise((r) => setTimeout(r, 20));
            yield word;
          }
        }
        new Chatbot(host, {
          title: 'Assistant',
          placeholder: 'Ask me anything…',
          // Names + avatars + timestamps + copy/clear actions all surfaced.
          userName: 'You',
          assistantName: 'Jects Bot',
          userAvatar: avatar('oklch(0.55 0.13 250)', 'Y'),
          assistantAvatar: avatar('oklch(0.6 0.15 200)', 'J'),
          showAvatars: true,
          showTimestamps: true,
          copyable: true,
          clearable: true,
          suggestions: ['What can you do?', 'Show me a code block', 'Summarize this page'],
          messages: [
            { role: 'assistant', text: 'Hi! I am a demo bot. How can I help you today?' },
            { role: 'user', text: 'What is this gallery?' },
            { role: 'assistant', text: "It's a live showcase of the **Jects UI** component library — every card is a real, interactive widget." },
          ],
          onSend: (text) => mockStream(text),
        });
        h.appendChild(el('div', { class: 'g-note', text: 'Avatars + names + timestamps on every turn; hover a message for the copy action, or Clear the transcript from the toolbar. Type and press Enter (Shift+Enter for a newline) — the mock provider streams a Markdown reply (heading, bold, a fenced code block, and a list) token by token. Swap onSend for OpenAI / Anthropic / a local model.' }));
      }, { block: true }));
    },
    { wide: true },
  ),
);

/* ════════════════════════ Integrated workflows ════════════════════════════
   The strategic differentiator: TWO modules sharing ONE data model, live-linked
   so an edit/selection in one updates the other on screen. This proves Jects is
   a single coherent operating system for enterprise planning UIs — not a bag of
   isolated widgets. Each route lazy-loads ONLY the modules it wires together
   (see SECTION_LOADERS above). The linkage — not the widgets — is the point. */

/* ── #flow-analytics — Pivot → Chart dashboard ───────────────────────────── */
main.appendChild(
  section(
    'flow-analytics',
    'Pivot → Chart dashboard',
    'One source dataset feeds a live Pivot cross-tab AND a Chart. The chart is rendered from the pivot’s CURRENT aggregates (read back via pivot.getResult()) — switch the measure or the row dimension and BOTH the cross-tab and the chart recompute from the same numbers. The chart is never a separate hardcoded series.',
    (grid) => {
      grid.appendChild(card('Pivot ↔ Chart — one dataset, the chart plots the pivot’s aggregates', (h) => {
        // ── ONE shared source dataset (flat regional sales records). ──
        const SRC = [];
        const regions = ['West', 'East', 'North', 'South'];
        const products = ['Widget', 'Gadget', 'Gizmo'];
        const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
        let seed = 7;
        const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        for (const region of regions) {
          for (const product of products) {
            for (const quarter of quarters) {
              SRC.push({ region, product, quarter,
                amount: 400 + Math.round(rand() * 3600),
                units: 4 + Math.round(rand() * 60) });
            }
          }
        }

        // ── Layout: caption · toolbar · two-up (pivot | chart). ──
        const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.6rem;width:100%' });
        const bar = el('div', { class: 'g-flow-toolbar' });
        const flow = el('div', { class: 'g-flow' });
        const pivotPanel = el('div', { class: 'g-flow__panel' });
        const chartPanel = el('div', { class: 'g-flow__panel' });
        pivotPanel.appendChild(el('h4', { text: 'Pivot cross-tab (source of truth)' }));
        chartPanel.appendChild(el('h4', { text: 'Chart (rendered from pivot.getResult())' }));
        const pivotHost = el('div', { class: 'g-flow-host g-flow-host--scroll' });
        const chartHost = el('div', { class: 'g-host-chart' });
        pivotPanel.appendChild(pivotHost);
        chartPanel.appendChild(chartHost);
        flow.appendChild(pivotPanel);
        flow.appendChild(chartPanel);
        const cap = el('div', { class: 'g-note' });
        wrap.appendChild(bar);
        wrap.appendChild(flow);
        wrap.appendChild(cap);
        h.appendChild(wrap);

        // Current pivot configuration (mutated by the toolbar, applied to BOTH).
        const MEASURES = { amount: 'Revenue ($)', units: 'Units' };
        let measure = 'amount';
        let dimension = 'region';

        const pivot = new PivotTable(pivotHost, {
          data: SRC,
          fields: [
            { field: 'region', label: 'Region' },
            { field: 'product', label: 'Product' },
            { field: 'quarter', label: 'Quarter' },
            { field: 'amount', label: 'Revenue', aggregator: 'sum' },
            { field: 'units', label: 'Units', aggregator: 'sum' },
          ],
          rows: [dimension],
          columns: ['quarter'],
          values: [{ field: measure, aggregator: 'sum', label: MEASURES[measure] }],
          mode: 'flat',
          totals: { grand: false, rows: false, columns: false },
        });

        const chart = new Chart(chartHost, { type: 'bar', height: 300, legend: true,
          categories: [], series: [] });

        // The whole point: build the chart's series from the pivot's live result.
        function chartFromPivot() {
          const res = pivot.getResult();
          if (!res) return;
          const leaves = res.columnLeaves.filter((l) => !l.isTotal);
          const categories = leaves.map((l) => l.path[l.path.length - 1] || l.valueLabel);
          const rows = res.matrix.filter((r) => !r.isTotal && r.depth === 0);
          const series = rows.map((r) => ({
            name: r.headers.filter(Boolean).join(' / ') || '—',
            data: leaves.map((l) => Number(r.cells[l.key] ?? 0)),
          }));
          chart.update({ categories, series });
          cap.textContent = `Chart shows ${series.length} ${dimension}(s) × ${categories.length} quarters of `
            + `${MEASURES[measure]}, computed live from the pivot’s aggregates. Toggle the measure or dimension — the cross-tab re-pivots and the chart redraws from the same numbers.`;
        }
        chartFromPivot();

        // ── Toolbar: measure + dimension toggles re-pivot AND re-chart. ──
        const tb = (label, onClick, pressed) => {
          const b = new Button(bar, { text: label, variant: pressed ? 'primary' : 'outline', size: 'sm' });
          b.el.setAttribute('aria-pressed', String(!!pressed));
          b.el.addEventListener('click', onClick);
          return b;
        };
        bar.appendChild(el('span', { class: 'g-note', text: 'Measure:' }));
        const measBtns = {};
        const setMeasure = (m) => {
          measure = m;
          pivot.update({ values: [{ field: measure, aggregator: 'sum', label: MEASURES[measure] }] });
          Object.entries(measBtns).forEach(([k, b]) => {
            const on = k === m; b.el.setAttribute('aria-pressed', String(on));
            b.update ? b.update({ variant: on ? 'primary' : 'outline' }) : 0;
          });
          chartFromPivot();
        };
        measBtns.amount = tb('Revenue', () => setMeasure('amount'), true);
        measBtns.units = tb('Units', () => setMeasure('units'), false);

        bar.appendChild(el('span', { class: 'g-note', text: 'Group rows by:' }));
        const dimBtns = {};
        const setDim = (d) => {
          dimension = d;
          pivot.update({ rows: [dimension] });
          Object.entries(dimBtns).forEach(([k, b]) => {
            const on = k === d; b.el.setAttribute('aria-pressed', String(on));
            b.update ? b.update({ variant: on ? 'primary' : 'outline' }) : 0;
          });
          chartFromPivot();
        };
        dimBtns.region = tb('Region', () => setDim('region'), true);
        dimBtns.product = tb('Product', () => setDim('product'), false);

        // Test hook: lets the headless harness drive + read the linkage.
        window.__JECTS_FLOW_ANALYTICS__ = { pivot, chart, chartFromPivot, setMeasure, setDim };
      }, { block: true }));
    },
    { wide: true },
  ),
);

/* ── #flow-planning — Kanban ↔ Gantt (shared task model) ──────────────────── */
main.appendChild(
  section(
    'flow-planning',
    'Kanban ↔ Gantt (shared task model)',
    'ONE array of task objects is the single source of truth. A Kanban board and a Gantt chart are two views of those SAME tasks. Move a card between columns (or click “Advance a task”) and the task’s status updates — the Gantt repaints that task’s % complete AND its label live. Dragging a task in the Gantt reflects its new dates back onto the card (bonus).',
    (grid) => {
      grid.appendChild(card('Kanban + Gantt over one shared task store — a status change in one repaints the other', (h) => {
        // ── THE shared task model (single source of truth). ──
        const T0 = Date.UTC(2026, 5, 1);
        const seed = [
          ['t1', 'Research spike', 'done', 0, 4],
          ['t2', 'API design', 'done', 4, 3],
          ['t3', 'Backend build', 'doing', 7, 8],
          ['t4', 'Frontend build', 'doing', 9, 8],
          ['t5', 'Integration', 'todo', 17, 4],
          ['t6', 'QA & UAT', 'todo', 21, 5],
          ['t7', 'Launch', 'review', 26, 2],
        ];
        const model = seed.map(([id, base, status, off, dur]) => ({
          id, base, status,
          start: T0 + off * DAY, end: T0 + (off + dur) * DAY, duration: dur * DAY,
        }));
        const byId = new Map(model.map((m) => [m.id, m]));
        const deps = [
          { id: 'p1', fromId: 't1', toId: 't2', type: 'FS' },
          { id: 'p2', fromId: 't2', toId: 't3', type: 'FS' },
          { id: 'p3', fromId: 't2', toId: 't4', type: 'FS' },
          { id: 'p4', fromId: 't3', toId: 't5', type: 'FS' },
          { id: 'p5', fromId: 't4', toId: 't5', type: 'FS' },
          { id: 'p6', fromId: 't5', toId: 't6', type: 'FS' },
          { id: 'p7', fromId: 't6', toId: 't7', type: 'FS' },
        ];

        const ORDER = ['todo', 'doing', 'review', 'done'];
        const LABEL = { todo: 'To Do', doing: 'In Progress', review: 'Review', done: 'Done' };
        const PCT = { todo: 0, doing: 50, review: 80, done: 100 };
        const ganttName = (m) => `${m.base} · ${LABEL[m.status]}`;

        // ── Layout: caption · toolbar · stacked (kanban / gantt). ──
        const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.6rem;width:100%' });
        const bar = el('div', { class: 'g-flow-toolbar' });
        const flow = el('div', { class: 'g-flow is-stack' });
        const kanbanPanel = el('div', { class: 'g-flow__panel' });
        const ganttPanel = el('div', { class: 'g-flow__panel' });
        kanbanPanel.appendChild(el('h4', { text: 'Kanban — status board (drag cards or use the toolbar)' }));
        ganttPanel.appendChild(el('h4', { text: 'Gantt — same tasks, % complete + label track status' }));
        const kanbanHost = el('div', { class: 'g-flow-host', style: 'height:320px' });
        const ganttHost = el('div', { class: 'g-flow-host', style: 'height:340px' });
        kanbanPanel.appendChild(kanbanHost);
        ganttPanel.appendChild(ganttHost);
        flow.appendChild(kanbanPanel);
        flow.appendChild(ganttPanel);
        const cap = el('div', { class: 'g-note' });
        wrap.appendChild(bar);
        wrap.appendChild(flow);
        wrap.appendChild(cap);
        h.appendChild(wrap);

        // ── Kanban view of the shared model. ──
        const board = new TaskBoard(kanbanHost, {
          columns: [
            { id: 'todo', title: 'To Do', color: 1 },
            { id: 'doing', title: 'In Progress', color: 3 },
            { id: 'review', title: 'Review', color: 4 },
            { id: 'done', title: 'Done', color: 5 },
          ],
          cards: model.map((m, i) => ({ id: m.id, column: m.status, order: i, title: m.base,
            tags: [{ text: LABEL[m.status], color: 1 + (i % 7) }] })),
        });

        // ── Gantt view of the SAME shared model. ──
        const gantt = new Gantt(ganttHost, {
          projectStart: T0,
          preset: { ...WEEK_AND_DAY, pxPerUnit: 22 },
          columns: [
            { field: 'name', header: 'Task', width: 220 },
            { field: 'percentDone', header: '% Done', width: 72 },
          ],
          tasks: model.map((m) => ({ id: m.id, name: ganttName(m),
            start: m.start, end: m.end, duration: m.duration, percentDone: PCT[m.status] })),
          dependencies: deps,
        });

        const counts = () => ORDER.map((c) => `${LABEL[c]} ${model.filter((m) => m.status === c).length}`).join(' · ');
        const updateCap = (msg) => {
          cap.textContent = (msg ? msg + ' ' : '')
            + `Shared model status: ${counts()}. Done = ${model.filter((m) => m.status === 'done').length}/${model.length}.`;
        };
        updateCap();

        // ── LIVE LINK: Kanban → Gantt. A card move = a status change on the
        //    shared task, which we push into the Gantt (label + % complete). ──
        let applying = false;
        board.on('cardMove', (e) => {
          const col = e.to && e.to.column;
          if (col == null) return;
          applying = true;
          try {
            for (const c of e.cards) {
              const m = byId.get(c.id);
              if (!m) continue;
              m.status = col;
              gantt.updateTask(c.id, { name: ganttName(m), percentDone: PCT[col] });
            }
          } finally { applying = false; }
          updateCap(`Moved “${(e.cards[0] || {}).title}” → ${LABEL[col] || col}; Gantt repainted.`);
        });

        // ── BONUS LINK: Gantt → Kanban. A genuine gantt drag (not our own
        //    write-back) reflects the new finish date onto the card. ──
        gantt.on('taskChange', (e) => {
          if (applying || !e || !e.task) return;
          const m = byId.get(e.task.id);
          if (!m) return;
          if (e.task.start != null) m.start = e.task.start;
          if (e.task.end != null) m.end = e.task.end;
          try { board.applyCardEdit(e.task.id, { description: 'Finish ' + new Date(m.end).toISOString().slice(0, 10) }); } catch (_) {}
          updateCap('Gantt edit reflected onto the card.');
        });

        // ── Toolbar: a real control that moves a card between columns. ──
        const advance = () => {
          for (let i = 0; i < ORDER.length - 1; i++) {
            const m = model.find((x) => x.status === ORDER[i]);
            if (m) { board.moveCard(m.id, { column: ORDER[i + 1] }); return m.id; }
          }
          return null;
        };
        const advBtn = new Button(bar, { text: 'Advance a task →', variant: 'primary', size: 'sm', icon: 'chevron-right' });
        advBtn.el.addEventListener('click', () => { if (!advance()) updateCap('All tasks are Done.'); });
        bar.appendChild(el('span', { class: 'g-note', text: 'Click to promote the earliest-stage task to the next column — watch the Gantt label + % complete update.' }));

        window.__JECTS_FLOW_PLANNING__ = { board, gantt, model, byId, advance, ganttName };
      }, { block: true }));
    },
    { wide: true },
  ),
);

/* ── #flow-data — Grid → Chart ────────────────────────────────────────────── */
main.appendChild(
  section(
    'flow-data',
    'Grid → Chart',
    'A data Grid and a Chart over ONE row set. Select rows in the grid (checkboxes, or click a row) and the chart plots exactly the selected products across the quarters — driven by the grid’s real selectionChange event. With nothing selected the chart shows every row; select one and it narrows live.',
    (grid) => {
      grid.appendChild(card('Grid selection drives the Chart — the chart plots the selected rows', (h) => {
        // ── ONE shared row set (product × quarterly revenue). ──
        const ROWS = [
          { id: 'widget', name: 'Widget', q1: 120, q2: 180, q3: 150, q4: 210 },
          { id: 'gadget', name: 'Gadget', q1: 90, q2: 70, q3: 130, q4: 160 },
          { id: 'gizmo', name: 'Gizmo', q1: 60, q2: 110, q3: 95, q4: 140 },
          { id: 'sprocket', name: 'Sprocket', q1: 200, q2: 150, q3: 175, q4: 120 },
          { id: 'doohickey', name: 'Doohickey', q1: 40, q2: 85, q3: 120, q4: 95 },
        ];
        const QCATS = ['Q1', 'Q2', 'Q3', 'Q4'];

        const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.6rem;width:100%' });
        const flow = el('div', { class: 'g-flow' });
        const gridPanel = el('div', { class: 'g-flow__panel' });
        const chartPanel = el('div', { class: 'g-flow__panel' });
        gridPanel.appendChild(el('h4', { text: 'Grid — select rows (checkbox or row click)' }));
        chartPanel.appendChild(el('h4', { text: 'Chart — plots the selected rows' }));
        const gridHost = el('div', { class: 'g-flow-host', style: 'height:300px' });
        const chartHost = el('div', { class: 'g-host-chart' });
        gridPanel.appendChild(gridHost);
        chartPanel.appendChild(chartHost);
        flow.appendChild(gridPanel);
        flow.appendChild(chartPanel);
        const cap = el('div', { class: 'g-note' });
        wrap.appendChild(flow);
        wrap.appendChild(cap);
        h.appendChild(wrap);

        const dataGrid = new Grid(gridHost, {
          data: ROWS,
          selection: 'multi',
          features: { selectionColumn: { headerCheckbox: true }, sort: { multi: false } },
          columns: [
            { field: 'name', header: 'Product', flex: 1, minWidth: 120, sortable: true },
            { field: 'q1', header: 'Q1', type: 'number', width: 70, align: 'end' },
            { field: 'q2', header: 'Q2', type: 'number', width: 70, align: 'end' },
            { field: 'q3', header: 'Q3', type: 'number', width: 70, align: 'end' },
            { field: 'q4', header: 'Q4', type: 'number', width: 70, align: 'end' },
          ],
        });

        const chart = new Chart(chartHost, { type: 'bar', height: 300, legend: true,
          categories: QCATS, series: [] });

        // The link: rebuild the chart's series from the grid's current selection.
        function syncChart() {
          let rows = [];
          try { rows = dataGrid.selection.getSelectedRows() || []; } catch (_) { rows = []; }
          const selected = rows.length > 0;
          const plot = selected ? rows : ROWS;
          chart.update({ categories: QCATS, series: plot.map((r) => ({ name: r.name, data: [r.q1, r.q2, r.q3, r.q4] })) });
          cap.textContent = selected
            ? `Charting ${plot.length} selected product(s): ${plot.map((r) => r.name).join(', ')}. Clear the selection to show all.`
            : `No selection — charting all ${ROWS.length} products. Select rows to filter the chart live.`;
        }
        dataGrid.on('selectionChange', syncChart);
        syncChart();

        window.__JECTS_FLOW_DATA__ = { grid: dataGrid, chart, syncChart, ROWS };
      }, { block: true }));
    },
    { wide: true },
  ),
);

/* ── Performance: live, measured benchmarks ──────────────────────────────────
   A dedicated proof page. On activation it BUILDS the heavy modules against
   large generated datasets, measures build+render wall time with
   performance.now(), then drives a short scroll/update loop and samples per-
   frame durations via requestAnimationFrame to derive an avg frame ms + ~FPS.
   The numbers are real measurements of THIS device — not a synthetic claim.

   Stable harness contract (also driven by visiting the page):
     window.__JECTS_PERF__ = {
       runAt: <number ms>,            // Date.now() of the last completed run
       results: [ { module, rows, buildMs, frameMs, fps } ]
     }
     window.__runJectsBench()         // async; (re)runs all benchmarks, fills
                                      // window.__JECTS_PERF__, resolves with the
                                      // results array. */
main.appendChild(
  section(
    'performance',
    'Performance',
    'Live, measured benchmarks — not synthetic claims. On open this page builds each heavy module against a large dataset, times the build+render with performance.now(), then samples ~30 animation frames while scrolling to derive average frame time and FPS. Numbers reflect THIS browser and CPU right now; press “Re-run benchmarks” to measure again.',
    (grid) => {
      grid.appendChild(card('Live benchmark results', (h) => {
        const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.75rem;width:100%' });
        const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.5rem;flex-wrap:wrap;align-items:center' });
        const statusEl = el('div', { class: 'g-note', style: 'min-height:1.2em' });
        // Sized, on-page-but-clipped sandbox so each module actually lays out +
        // virtualizes (offscreen with zero size would skip virtualization work
        // and give dishonest numbers). overflow:hidden keeps the page tidy.
        const sandbox = el('div', {
          style: 'position:relative;height:420px;width:100%;overflow:hidden;border:1px solid var(--jects-border,#3a3a42);border-radius:var(--jects-radius,8px)',
        });
        const tableWrap = el('div', { style: 'width:100%;overflow:auto' });

        wrap.appendChild(bar);
        wrap.appendChild(statusEl);
        wrap.appendChild(tableWrap);
        wrap.appendChild(el('div', { class: 'g-note', style: 'margin-top:.25rem',
          text: 'Methodology: Measured live in your browser just now — numbers depend on your device/CPU; this is not a synthetic claim. Build+render is wall time around the component constructor (performance.now()). Avg frame is the mean of ~30 requestAnimationFrame deltas captured while driving a scroll/update loop; ~FPS = 1000 / avg-frame-ms, capped at 60 (the display refresh ceiling).' }));
        wrap.appendChild(sandbox);
        h.appendChild(wrap);

        const setStatus = (m) => { statusEl.textContent = m; };

        // Render (or re-render) the results table from an array of measurements.
        function renderTable(results) {
          const thead = el('thead', {}, [
            el('tr', {}, [
              el('th', { text: 'Module' }),
              el('th', { text: 'Dataset' }),
              el('th', { style: 'text-align:right', text: 'Build+render (ms)' }),
              el('th', { style: 'text-align:right', text: 'Avg frame (ms)' }),
              el('th', { style: 'text-align:right', text: '~FPS' }),
            ]),
          ]);
          const tbody = el('tbody', {}, results.map((r) => el('tr', {}, [
            el('td', { text: r.module }),
            el('td', { text: r.dataset }),
            el('td', { style: 'text-align:right;font-variant-numeric:tabular-nums', text: String(r.buildMs) }),
            el('td', { style: 'text-align:right;font-variant-numeric:tabular-nums', text: r.frameMs.toFixed(1) }),
            el('td', { style: 'text-align:right;font-variant-numeric:tabular-nums', text: String(r.fps) }),
          ])));
          const table = el('table', { class: 'g-perf-table', style: 'width:100%;border-collapse:collapse' }, [thead, tbody]);
          tableWrap.replaceChildren(table);
        }

        // Sample ~`frames` rAF deltas while running `tick(i)` each frame (the
        // interaction driver — e.g. a scroll). Resolves to the mean delta in ms.
        function sampleFrames(tick, frames = 30) {
          return new Promise((resolve) => {
            const deltas = [];
            let last = performance.now();
            let i = 0;
            function step(now) {
              deltas.push(now - last);
              last = now;
              try { tick(i); } catch (_) {}
              i++;
              if (i < frames) requestAnimationFrame(step);
              else {
                // Drop the first delta (warm-up / scheduling jitter), then mean.
                const use = deltas.length > 1 ? deltas.slice(1) : deltas;
                const avg = use.reduce((a, b) => a + b, 0) / use.length;
                resolve(avg);
              }
            }
            requestAnimationFrame((t) => { last = t; requestAnimationFrame(step); });
          });
        }

        // Find the inner scrollable viewport a module created (so the scroll
        // loop actually moves rows through the virtualizer). Falls back to host.
        function scrollerIn(host) {
          const cands = host.querySelectorAll('*');
          for (const node of cands) {
            if (node.scrollHeight - node.clientHeight > 40) return node;
          }
          return host;
        }

        // Run ONE module benchmark: mount a fresh host in the sandbox, time the
        // build, then sample frames while scrolling. Returns a result record.
        async function benchOne({ module, dataset, rows, mount }) {
          setStatus('Benchmarking ' + module + ' (' + dataset + ')…');
          sandbox.replaceChildren();
          const host = el('div', { style: 'position:absolute;inset:0;width:100%;height:100%;overflow:auto' });
          sandbox.appendChild(host);
          // Let the empty host paint before the (blocking) build so the timer
          // captures build+render, not layout of unrelated chrome.
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const t0 = performance.now();
          mount(host);
          const buildMs = Math.round(performance.now() - t0);
          // Let the first painted frame settle, then drive a scroll loop.
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const sc = scrollerIn(host);
          const max = Math.max(0, sc.scrollHeight - sc.clientHeight);
          const frameMs = await sampleFrames((i) => {
            // Saw-tooth scroll across the full extent over the sample window.
            if (max > 0) sc.scrollTop = Math.round((i % 30) / 29 * max);
          }, 30);
          const fps = Math.min(60, Math.round(1000 / Math.max(frameMs, 0.001)));
          return { module, dataset, rows, buildMs, frameMs, fps };
        }

        // The benchmark suite. Each entry builds a real component with the same
        // config style as its own gallery route, against a large generated set.
        function suite() {
          return [
            {
              module: 'Grid', dataset: '100,000 rows', rows: 100_000,
              mount: (host) => {
                new Grid(host, {
                  data: genGridRows(100_000),
                  selection: 'multi',
                  features: { sort: { multi: true }, filter: true, columnResize: true },
                  columns: [
                    { field: 'id', header: 'ID', type: 'number', width: 80, sortable: true, frozen: 'left' },
                    { field: 'name', header: 'Name', flex: 1, minWidth: 160, sortable: true, filterable: true },
                    { field: 'dept', header: 'Department', width: 150, sortable: true, filterable: true },
                    { field: 'status', header: 'Status', width: 120, sortable: true, filterable: true },
                    { field: 'salary', header: 'Salary ($)', type: 'number', width: 120, align: 'end', sortable: true },
                    { field: 'hired', header: 'Hired', type: 'date', width: 130, sortable: true },
                    { field: 'progress', header: 'Progress %', type: 'number', width: 120, align: 'end', sortable: true },
                  ],
                });
              },
            },
            {
              module: 'Pivot', dataset: '50,000 source records', rows: 50_000,
              mount: (host) => {
                new PivotTable(host, {
                  data: genPivotRecords(50_000),
                  fields: [
                    { field: 'region', label: 'Region' },
                    { field: 'product', label: 'Product' },
                    { field: 'channel', label: 'Channel' },
                    { field: 'quarter', label: 'Quarter' },
                    { field: 'amount', label: 'Amount', aggregator: 'sum' },
                    { field: 'units', label: 'Units', aggregator: 'sum' },
                  ],
                  rows: ['region', 'product'],
                  columns: ['quarter'],
                  values: [{ field: 'amount', aggregator: 'sum', label: 'Revenue' }],
                  mode: 'tree',
                  totals: { grand: true, rows: true, columns: true },
                });
              },
            },
            {
              module: 'Scheduler', dataset: '100 resources × ~2,000 events', rows: 2_000,
              mount: (host) => {
                host.style.height = '100%';
                const data = genSchedulerData(100, 20);
                new Scheduler(host, {
                  resources: data.resources,
                  events: data.events,
                  preset: HOUR_AND_DAY,
                  range: { start: data.base, end: data.base + DAY * 20 },
                  panEnabled: true,
                  infiniteScroll: true,
                });
              },
            },
            {
              module: 'Gantt', dataset: '1,000 tasks · ~2,000 deps', rows: 1_000,
              mount: (host) => {
                host.style.height = '100%';
                const proj = genGanttProject(1000);
                new Gantt(host, {
                  projectStart: proj.T0,
                  preset: { ...WEEK_AND_DAY, pxPerUnit: 12 },
                  columns: DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
                  tasks: proj.tasks,
                  dependencies: proj.dependencies,
                });
              },
            },
          ];
        }

        // Run (or re-run) every benchmark, publish the harness contract, and
        // repaint the table. Resolves with the results array.
        let running = false;
        async function runAll() {
          if (running) return (window.__JECTS_PERF__ && window.__JECTS_PERF__.results) || [];
          running = true;
          rerunBtn.el.setAttribute('disabled', 'disabled');
          const results = [];
          try {
            for (const spec of suite()) {
              const r = await benchOne(spec);
              results.push(r);
              renderTable(results); // progressive — each row appears as it lands
            }
            sandbox.replaceChildren(); // free the last (heavy) component
            window.__JECTS_PERF__ = { runAt: Date.now(), results: results.map((r) => ({
              module: r.module, rows: r.rows, buildMs: r.buildMs, frameMs: r.frameMs, fps: r.fps,
            })) };
            setStatus('Done — measured ' + results.length + ' modules live on this device at '
              + new Date(window.__JECTS_PERF__.runAt).toLocaleTimeString() + '.');
          } catch (e) {
            setStatus('Benchmark error: ' + (e && e.message ? e.message : String(e)));
            console.error('[gallery] performance bench failed:', e);
          } finally {
            running = false;
            rerunBtn.el.removeAttribute('disabled');
          }
          return (window.__JECTS_PERF__ && window.__JECTS_PERF__.results) || [];
        }

        // Expose the global harness entry point (returns the results array).
        window.__runJectsBench = () => runAll();

        const rerunBtn = new Button(bar, { text: 'Re-run benchmarks', variant: 'primary', size: 'sm', icon: 'arrow-down' });
        rerunBtn.el.addEventListener('click', () => { window.__runJectsBench(); });

        // Auto-run once on first activation so visiting produces numbers without
        // a click. Two RAFs so the page chrome paints before the blocking work.
        renderTable([]);
        setStatus('Running benchmarks on this device…');
        requestAnimationFrame(() => requestAnimationFrame(() => { window.__runJectsBench(); }));
      }, { block: true }));
    },
    { wide: true },
  ),
);

/* ── Server-side data: a Grid bound to a simulated async backend ──────────────
   Proves remote data integration. A large in-memory dataset acts as the mock
   server; the client only ever holds ONE page in the DOM at a time. Sort +
   filter + pagination are applied SERVER-SIDE inside queryServer() (which adds
   ~150ms artificial latency), and every call is logged to a Request-log panel
   as the proof artifact. The grid is driven manually: sort/filter/page events
   call queryServer and grid.update({ data }). (The grid also ships an
   infiniteLoadFeature whose loadRange(request) → { rows, totalCount } hook is
   the same server seam wired to scroll instead of a pager.) */
main.appendChild(
  section(
    'server-data',
    'Server-side data',
    'A Grid over a simulated REST/GraphQL backend. The mock server holds 100,000 rows; sorting, filtering and pagination all happen server-side and the client receives exactly one page per request (~150 ms latency). Only one page is ever in the DOM. Every server call is recorded in the Request log on the right — the proof that the grid fetches a page at a time, never the whole set.',
    (grid) => {
      grid.appendChild(card('Grid ↔ simulated server (server-side sort · filter · paging)', (h) => {
        const PAGE_SIZE = 50;
        const TOTAL = 100_000;
        // The mock backend: the full dataset lives here and NEVER reaches the
        // client whole — queryServer slices a single page out of it.
        const BACKEND = genGridRows(TOTAL);

        // Server-side query: apply filter → sort → paginate, with latency. The
        // client only ever receives `rows` (one page) + `total`.
        async function queryServer({ page, pageSize, sort, filter }) {
          await new Promise((r) => setTimeout(r, 150)); // artificial latency
          let working = BACKEND;
          if (filter && filter.value) {
            const needle = String(filter.value).toLowerCase();
            working = working.filter((row) => String(row[filter.field] ?? '').toLowerCase().includes(needle));
          }
          if (sort && sort.field) {
            const dir = sort.dir === 'desc' ? -1 : 1;
            // Copy before sort so the backing store stays in its canonical order.
            working = working.slice().sort((a, b) => {
              const av = a[sort.field], bv = b[sort.field];
              if (av < bv) return -1 * dir;
              if (av > bv) return 1 * dir;
              return 0;
            });
          }
          const total = working.length;
          const start = page * pageSize;
          const rows = working.slice(start, start + pageSize);
          return { rows, total };
        }

        // Layout: grid on the left, request-log panel on the right.
        const layout = el('div', { style: 'display:flex;gap:.75rem;width:100%;flex-wrap:wrap' });
        const left = el('div', { style: 'flex:1 1 520px;min-width:320px;display:flex;flex-direction:column;gap:.5rem' });
        const right = el('div', { style: 'flex:1 1 300px;min-width:280px;display:flex;flex-direction:column;gap:.4rem' });
        layout.appendChild(left);
        layout.appendChild(right);
        h.appendChild(layout);

        // Controls: filter field + value, page nav.
        const controls = el('div', { style: 'display:flex;gap:.5rem;flex-wrap:wrap;align-items:center' });
        const pager = el('div', { style: 'display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin-top:.25rem' });
        const gridHost = el('div', { class: 'g-host-grid' });
        left.appendChild(controls);
        left.appendChild(gridHost);
        left.appendChild(pager);

        right.appendChild(el('div', { class: 'g-card__hd', style: 'padding:0', text: 'Request log' }));
        const logEl = el('div', {
          style: 'flex:1 1 auto;min-height:260px;max-height:380px;overflow:auto;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--jects-muted,#1b1b1f);border:1px solid var(--jects-border,#3a3a42);border-radius:var(--jects-radius,8px);padding:.5rem',
        });
        right.appendChild(logEl);

        // Live query state.
        let state = { page: 0, pageSize: PAGE_SIZE, sort: { field: 'id', dir: 'asc' }, filter: { field: 'name', value: '' } };
        let total = TOTAL;
        let callNo = 0;

        function logCall(req, latency, rowsReturned, totalCount) {
          callNo++;
          const line = el('div', { style: 'padding:.2rem 0;border-bottom:1px solid var(--jects-border,#33333a)' });
          line.appendChild(el('div', { style: 'font-weight:600',
            text: '#' + callNo + ' page=' + req.page + ' size=' + req.pageSize }));
          line.appendChild(el('div', {
            text: 'sort=' + (req.sort && req.sort.field ? req.sort.field + ' ' + req.sort.dir : '—')
              + ' · filter=' + (req.filter && req.filter.value ? req.filter.field + '~"' + req.filter.value + '"' : '—') }));
          line.appendChild(el('div', {
            text: 'latency=' + latency + 'ms · rows=' + rowsReturned + ' · total=' + totalCount.toLocaleString() }));
          logEl.insertBefore(line, logEl.firstChild);
        }

        // The grid — starts empty; the client only ever holds one page of data.
        const dataGrid = new Grid(gridHost, {
          data: [],
          columns: [
            { field: 'id', header: 'ID', type: 'number', width: 90, align: 'end' },
            { field: 'name', header: 'Name', flex: 1, minWidth: 160 },
            { field: 'dept', header: 'Department', width: 150 },
            { field: 'status', header: 'Status', width: 120 },
            { field: 'salary', header: 'Salary ($)', type: 'number', width: 130, align: 'end' },
            { field: 'hired', header: 'Hired', type: 'date', width: 130 },
          ],
        });

        const pageInfo = el('span', { class: 'g-note' });
        let busy = false;

        async function refresh() {
          if (busy) return;
          busy = true;
          const req = { page: state.page, pageSize: state.pageSize, sort: state.sort, filter: state.filter };
          const t0 = performance.now();
          const { rows, total: t } = await queryServer(req);
          const latency = Math.round(performance.now() - t0);
          total = t;
          dataGrid.update({ data: rows }); // only this page enters the DOM
          logCall(req, latency, rows.length, total);
          const pages = Math.max(1, Math.ceil(total / state.pageSize));
          const from = total === 0 ? 0 : state.page * state.pageSize + 1;
          const to = Math.min(total, (state.page + 1) * state.pageSize);
          pageInfo.textContent = total === 0
            ? 'No matching rows.'
            : 'Showing ' + from.toLocaleString() + '–' + to.toLocaleString() + ' of ' + total.toLocaleString()
              + ' (page ' + (state.page + 1) + ' / ' + pages.toLocaleString() + ')';
          prevBtn.el[state.page <= 0 ? 'setAttribute' : 'removeAttribute']('disabled', 'disabled');
          nextBtn.el[state.page >= pages - 1 ? 'setAttribute' : 'removeAttribute']('disabled', 'disabled');
          busy = false;
        }

        // — Filter controls —
        controls.appendChild(el('label', { class: 'g-note', text: 'Filter' }));
        const filterField = el('select', { class: 'jects-select__control', style: 'min-width:120px' });
        [['name', 'Name'], ['dept', 'Department'], ['status', 'Status']].forEach(([v, l]) => {
          filterField.appendChild(el('option', { value: v, text: l }));
        });
        const filterValue = el('input', { class: 'jects-textfield__input', type: 'search', placeholder: 'contains…', style: 'min-width:160px' });
        controls.appendChild(filterField);
        controls.appendChild(filterValue);
        let filterTimer = null;
        const applyFilter = () => {
          state.filter = { field: filterField.value, value: filterValue.value.trim() };
          state.page = 0;
          refresh();
        };
        filterField.addEventListener('change', applyFilter);
        filterValue.addEventListener('input', () => { clearTimeout(filterTimer); filterTimer = setTimeout(applyFilter, 250); });

        // — Sort controls (server-side) —
        controls.appendChild(el('label', { class: 'g-note', style: 'margin-left:.5rem', text: 'Sort' }));
        const sortField = el('select', { class: 'jects-select__control', style: 'min-width:120px' });
        [['id', 'ID'], ['name', 'Name'], ['salary', 'Salary'], ['hired', 'Hired']].forEach(([v, l]) => {
          sortField.appendChild(el('option', { value: v, text: l }));
        });
        controls.appendChild(sortField);
        const sortDirBtn = new Button(controls, { text: 'Asc ↑', variant: 'secondary', size: 'sm' });
        sortField.addEventListener('change', () => { state.sort = { field: sortField.value, dir: state.sort.dir }; state.page = 0; refresh(); });
        sortDirBtn.el.addEventListener('click', () => {
          state.sort = { field: state.sort.field, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' };
          sortDirBtn.el.textContent = state.sort.dir === 'asc' ? 'Asc ↑' : 'Desc ↓';
          state.page = 0; refresh();
        });

        // — Pager —
        const prevBtn = new Button(pager, { text: '‹ Prev', variant: 'secondary', size: 'sm' });
        const nextBtn = new Button(pager, { text: 'Next ›', variant: 'secondary', size: 'sm' });
        prevBtn.el.addEventListener('click', () => { if (state.page > 0) { state.page--; refresh(); } });
        nextBtn.el.addEventListener('click', () => {
          const pages = Math.max(1, Math.ceil(total / state.pageSize));
          if (state.page < pages - 1) { state.page++; refresh(); }
        });
        pager.appendChild(pageInfo);

        h.appendChild(el('div', { class: 'g-note', style: 'margin-top:.5rem',
          text: 'This models a real backend (REST/GraphQL): queryServer({ page, pageSize, sort, filter }) applies sort + filter + pagination server-side against a 100,000-row store and returns one page (~150 ms latency). The grid only ever holds that one page in the DOM — paging, sorting and filtering each issue a fresh server call (see the Request log). The grid package also exposes infiniteLoadFeature, whose loadRange(request) → { rows, totalCount } callback is this same server seam wired to scroll-driven prefetch instead of an explicit pager.' }));

        // Expose for harness/debugging + initial load.
        window.__JECTS_SERVER_DATA__ = { grid: dataGrid, queryServer, getState: () => state, getLog: () => logEl };
        refresh();
      }, { block: true }));
    },
    { wide: true },
  ),
);

/* ════════════════════════ docs site: nav + tabs + markdown ════════════════
   The gallery is presented as a small product/docs site: a grouped, searchable
   sidebar; each route is a tabbed page (Demo + Docs); the Docs tab fetches the
   matching `docs-content/<id>.md`, renders it with a tiny markdown→HTML pass,
   and runs the result through `sanitizeHtml` from @jects/core before insertion.
   The Demo tab is the EXISTING lazy-loaded section, untouched. */

/* ── route metadata: title · search blurb · which markdown doc it shows ──── */
const ROUTE_META = {
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
};

/* ── sidebar grouping (the product taxonomy) ──────────────────────────── */
const SIDEBAR_GROUPS = [
  { label: 'Foundation', items: ['foundations', 'core', 'theme', 'icons', 'timeline-core'] },
  { label: 'Theme', items: ['customizer'] },
  { label: 'Data', items: ['grid', 'pivot', 'spreadsheet'] },
  { label: 'Scheduling', items: ['gantt', 'scheduler', 'calendar', 'booking'] },
  { label: 'Boards & Tasks', items: ['kanban', 'todo', 'charts', 'diagram'] },
  { label: 'Widgets & Chat', items: ['widgets', 'buttons', 'inputs', 'forms', 'layout', 'navigation', 'overlays', 'richtext', 'chatbot'] },
  { label: 'Integrated workflows', items: ['flow-analytics', 'flow-planning', 'flow-data'] },
  { label: 'Live', items: ['realtime'] },
  { label: 'Proof', items: ['performance', 'server-data'] },
];

/* ── tiny markdown → HTML (sanitized by @jects/core before it touches DOM) ── */
function mdEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
/** Inline spans: code, images, links, bold, italic. Code is protected first. */
function mdInline(text) {
  const codes = [];
  let t = text.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
  t = mdEscape(t);
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => `<img src="${url}" alt="${alt}">`);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => `<a href="${url}">${txt}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  t = t.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  t = t.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${mdEscape(codes[i])}</code>`);
  return t;
}
const _mdSep = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;
function _mdSplitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}
function _mdParseList(lines, start) {
  const indent = lines[start].match(/^(\s*)/)[1].length;
  const ordered = /^\s*\d+\.\s+/.test(lines[start]);
  const tag = ordered ? 'ol' : 'ul';
  let i = start;
  let html = `<${tag}>`;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*$/.test(l)) {
      let j = i + 1;
      while (j < lines.length && /^\s*$/.test(lines[j])) j++;
      if (j < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[j]) &&
          lines[j].match(/^(\s*)/)[1].length >= indent) { i = j; continue; }
      break;
    }
    const m = l.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (!m) break;
    const ind = m[1].length;
    if (ind < indent) break;
    if (ind > indent) {
      const [nested, ni] = _mdParseList(lines, i);
      html = html.replace(/<\/li>$/, nested + '</li>');
      i = ni;
      continue;
    }
    html += `<li>${mdInline(m[3])}</li>`;
    i++;
  }
  return [html + `</${tag}>`, i];
}
function mdToHtml(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const blank = (l) => /^\s*$/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { i++; continue; }
    // fenced code
    const fence = line.match(/^\s*```+\s*([\w-]*)\s*$/);
    if (fence) {
      i++;
      const buf = [];
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      const cls = fence[1] ? ` class="language-${fence[1]}"` : '';
      out.push(`<pre><code${cls}>${mdEscape(buf.join('\n'))}</code></pre>`);
      continue;
    }
    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${mdInline(h[2].trim())}</h${h[1].length}>`); i++; continue; }
    // horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    // table
    if (line.includes('|') && i + 1 < lines.length && _mdSep.test(lines[i + 1])) {
      const header = _mdSplitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !blank(lines[i])) { rows.push(_mdSplitRow(lines[i])); i++; }
      let t = '<table><thead><tr>' + header.map((c) => `<th>${mdInline(c)}</th>`).join('') + '</tr></thead><tbody>';
      for (const r of rows) t += '<tr>' + r.map((c) => `<td>${mdInline(c)}</td>`).join('') + '</tr>';
      out.push(t + '</tbody></table>');
      continue;
    }
    // blockquote
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote>${mdToHtml(buf.join('\n'))}</blockquote>`);
      continue;
    }
    // list
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const [html, ni] = _mdParseList(lines, i);
      out.push(html); i = ni; continue;
    }
    // paragraph
    const buf = [];
    while (i < lines.length && !blank(lines[i]) &&
        !/^(#{1,6})\s+/.test(lines[i]) && !/^\s*```+/.test(lines[i]) && !/^\s*>/.test(lines[i]) &&
        !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) && !/^\s*([-*_])\1{2,}\s*$/.test(lines[i]) &&
        !(lines[i].includes('|') && i + 1 < lines.length && _mdSep.test(lines[i + 1]))) {
      buf.push(lines[i]); i++;
    }
    out.push(`<p>${mdInline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

/* ── docs loading: fetch the .md lazily (per route, cached), render+sanitize ── */
let _sanitizeHtml = null;
async function getSanitizer() {
  if (!_sanitizeHtml) { const m = await importOnce('@jects/core'); _sanitizeHtml = m.sanitizeHtml; }
  return _sanitizeHtml;
}
function loadDocs(docId, panel) {
  if (panel._docsLoaded) return;
  panel._docsLoaded = true;
  panel.replaceChildren(el('div', { class: 'g-loading', role: 'status' }, [
    el('div', { class: 'g-spinner', 'aria-hidden': 'true' }),
    el('div', { text: 'Loading documentation…' }),
  ]));
  (async () => {
    try {
      const res = await fetch('./docs-content/' + docId + '.md');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const md = await res.text();
      const sanitize = await getSanitizer();
      const article = el('article', { class: 'g-doc' });
      article.innerHTML = sanitize(mdToHtml(md)); // sanitized before it touches the DOM
      panel.replaceChildren(article);
    } catch (err) {
      panel._docsLoaded = false; // allow a retry next time the tab is opened
      panel.replaceChildren(el('div', { class: 'g-note', style: 'color:oklch(var(--jects-destructive))' },
        'Could not load documentation: ' + (err && err.message ? err.message : String(err))));
      console.error('[gallery] docs "' + docId + '" failed to load:', err);
    }
  })();
}

/* ════════════════════ per-component "Code" tab (framework usage) ══════════
   Every route that has a live demo AND a framework wrapper gets a Code tab.
   It shows how to use that component in each supported flavor — Vanilla TS,
   React, Vue, Angular and Web Component — generated from one manifest so the
   names (engine class + import path, the `Jects<Name>` wrapper export, the
   `jects-<name>` custom-element tag, a representative event) stay accurate to
   the real `@jects/{react,vue,angular,elements}` exports. Documentation only —
   the snippets are rendered + copyable, never executed. */

const FRAMEWORKS = [
  ['vanilla', 'Vanilla TS'],
  ['react', 'React'],
  ['vue', 'Vue'],
  ['angular', 'Angular'],
  ['element', 'Web Component'],
];

/* route id → one or more component descriptors. className / importPath /
   wrapperName / elementTag / event are the REAL wrapper names (verified against
   packages/{react,vue,angular,elements}/src/index.ts); `config` is a short,
   representative literal trimmed from the live demo. The map is the single
   source of truth — every snippet is generated from it, keeping things DRY. */
const CODE_TEMPLATES = {
  // ── data ──────────────────────────────────────────────────────────────
  grid: [{
    className: 'Grid', importPath: '@jects/grid', wrapperName: 'JectsGrid',
    elementTag: 'jects-grid', event: 'selectionChange',
    config:
`  columns: [
    { field: 'name', header: 'Name', flex: 1, sortable: true },
    { field: 'salary', header: 'Salary', type: 'number', align: 'end' },
  ],
  data: [
    { name: 'Ada Lovelace', salary: 1200 },
    { name: 'Alan Turing', salary: 1500 },
  ],`,
  }],
  pivot: [{
    className: 'PivotTable', importPath: '@jects/pivot', wrapperName: 'JectsPivot',
    elementTag: 'jects-pivot', event: 'configChange',
    config:
`  fields: [
    { field: 'region', label: 'Region' },
    { field: 'quarter', label: 'Quarter' },
    { field: 'amount', label: 'Amount', aggregator: 'sum' },
  ],
  rows: ['region'],
  columns: ['quarter'],
  values: [{ field: 'amount', aggregator: 'sum', label: 'Revenue' }],
  data: [
    { region: 'West', quarter: 'Q1', amount: 24600 },
    { region: 'East', quarter: 'Q1', amount: 18200 },
  ],`,
  }],
  spreadsheet: [{
    className: 'Spreadsheet', importPath: '@jects/spreadsheet', wrapperName: 'JectsSpreadsheet',
    elementTag: 'jects-spreadsheet', event: 'cellChange',
    config:
`  sheets: [
    {
      id: 'sales',
      name: 'Sales',
      rowCount: 50,
      colCount: 8,
      cells: {
        '0,0': { value: 'Region', style: { bold: true } },
        '0,1': { value: 'Revenue', style: { bold: true } },
        '1,0': { value: 'West' }, '1,1': { value: 24600 },
        '2,0': { value: 'East' }, '2,1': { value: 18200 },
        '3,1': { value: '=SUM(B2:B3)' },
      },
    },
  ],`,
  }],
  // ── scheduling ────────────────────────────────────────────────────────
  gantt: [{
    className: 'Gantt', importPath: '@jects/gantt', wrapperName: 'JectsGantt',
    elementTag: 'jects-gantt', event: 'taskChange',
    config:
`  projectStart: Date.now(),
  showCriticalPath: true,
  tasks: [
    { id: 'd', name: 'Discovery', expanded: true },
    { id: 'd1', name: 'Interviews', parentId: 'd', start: Date.now(), duration: 3 },
    { id: 'd2', name: 'Requirements', parentId: 'd', start: Date.now(), duration: 4 },
  ],
  dependencies: [
    { id: 'k1', fromId: 'd1', toId: 'd2', type: 'FS' },
  ],`,
  }],
  scheduler: [{
    className: 'Scheduler', importPath: '@jects/scheduler', wrapperName: 'JectsScheduler',
    elementTag: 'jects-scheduler', event: 'eventChange',
    config:
`  resources: [
    { id: 'r1', name: 'Alice Nguyen', role: 'Lead' },
    { id: 'r2', name: 'Bob Martin', role: 'Field' },
  ],
  events: [
    { id: 'e1', resourceId: 'r1', name: 'Design review', startDate: Date.now(), endDate: Date.now() + 3600e3 * 3 },
    { id: 'e2', resourceId: 'r2', name: 'Site survey', startDate: Date.now(), endDate: Date.now() + 3600e3 * 2 },
  ],`,
  }],
  calendar: [{
    className: 'Calendar', importPath: '@jects/calendar', wrapperName: 'JectsCalendar',
    elementTag: 'jects-calendar', event: 'eventClick',
    config:
`  date: new Date(),
  view: 'week',
  weekStart: 1,
  categories: [
    { id: 'work', name: 'Work', color: 'data-1' },
    { id: 'personal', name: 'Personal', color: 'data-2' },
  ],
  events: [
    { id: '1', title: 'Standup', categoryId: 'work', start: Date.now(), end: Date.now() + 3600e3 },
  ],`,
  }],
  booking: [{
    className: 'Booking', importPath: '@jects/booking', wrapperName: 'JectsBooking',
    elementTag: 'jects-booking', event: 'book',
    config:
`  date: new Date(),
  timeFormat: '12h',
  slotsHeading: 'Choose a time',
  services: [
    { id: 'consult', name: 'Intro consultation', duration: 30, price: 0 },
    { id: 'demo', name: 'Product demo', duration: 60, price: 150, currency: 'USD' },
  ],
  resources: [
    { id: 'alex', name: 'Alex Rivera' },
  ],`,
  }],
  // ── boards & tasks ──────────────────────────────────────────────────────
  kanban: [{
    className: 'TaskBoard', importPath: '@jects/kanban', wrapperName: 'JectsKanban',
    elementTag: 'jects-kanban', event: 'cardMove',
    config:
`  columns: [
    { id: 'todo', title: 'To Do' },
    { id: 'doing', title: 'In Progress', limit: 3 },
    { id: 'done', title: 'Done' },
  ],
  cards: [
    { id: 1, column: 'todo', title: 'Design tokens audit' },
    { id: 2, column: 'doing', title: 'Build grid demo' },
  ],`,
  }],
  todo: [{
    className: 'TodoList', importPath: '@jects/todo', wrapperName: 'JectsTodo',
    elementTag: 'jects-todo', event: 'change',
    config:
`  statuses: [
    { id: 'todo', label: 'To do', isDone: false },
    { id: 'doing', label: 'In progress', isDone: false, wipLimit: 2 },
    { id: 'done', label: 'Done', isDone: true },
  ],
  assignees: ['KM', 'Alex', 'Sam'],`,
  }],
  charts: [{
    className: 'Chart', importPath: '@jects/charts', wrapperName: 'JectsChart',
    elementTag: 'jects-chart', event: 'pointClick',
    config:
`  type: 'bar',
  height: 220,
  categories: ['Jan', 'Feb', 'Mar', 'Apr'],
  series: [
    { name: 'West', data: [12, 18, 9, 14] },
    { name: 'East', data: [8, 11, 15, 10] },
  ],`,
  }],
  diagram: [{
    className: 'Diagram', importPath: '@jects/diagram', wrapperName: 'JectsDiagram',
    elementTag: 'jects-diagram', event: 'change',
    config:
`  mode: 'flow',
  editable: true,
  grid: true,
  shapes: [
    { id: 'start', type: 'start', x: 180, y: 20, w: 140, h: 56, text: 'Start' },
    { id: 'check', type: 'decision', x: 170, y: 130, w: 160, h: 90, text: 'Valid?' },
    { id: 'end', type: 'end', x: 180, y: 280, w: 140, h: 56, text: 'Done' },
  ],`,
  }],
  // ── chat ────────────────────────────────────────────────────────────────
  chatbot: [{
    className: 'Chatbot', importPath: '@jects/chatbot', wrapperName: 'JectsChatbot',
    elementTag: 'jects-chatbot', event: 'send',
    config:
`  title: 'Assistant',
  placeholder: 'Ask me anything…',
  suggestions: ['What can you do?', 'Summarize this page'],
  messages: [
    { role: 'assistant', text: 'Hi! How can I help you today?' },
  ],`,
  }],
  // ── widgets ───────────────────────────────────────────────────────────
  buttons: [{
    className: 'Button', importPath: '@jects/widgets', wrapperName: 'JectsButton',
    elementTag: 'jects-button', event: 'click',
    config:
`  text: 'Primary',
  variant: 'primary',`,
  }],
  forms: [{
    className: 'Form', importPath: '@jects/widgets', wrapperName: 'JectsForm',
    elementTag: 'jects-form', event: 'submit',
    config:
`  validateOn: 'blur',
  fields: [
    { name: 'name', control: 'text', label: 'Name', rules: { required: true } },
    { name: 'email', control: 'email', label: 'Email', rules: { required: true, email: true } },
  ],
  submitText: 'Send',`,
  }],
  overlays: [{
    className: 'Window', importPath: '@jects/widgets', wrapperName: 'JectsWindow',
    elementTag: 'jects-window', event: 'close',
    config:
`  title: 'Untitled',
  x: 120, y: 120, width: 380,
  text: 'A draggable, resizable floating panel.',
  minimizable: true,`,
  }],
  inputs: [
    {
      className: 'TextField', importPath: '@jects/widgets', wrapperName: 'JectsTextField',
      elementTag: 'jects-text-field', event: 'change',
      config:
`  label: 'Email',
  value: 'jane@example.com',
  inputType: 'email',
  clearable: true,`,
    },
    {
      className: 'Select', importPath: '@jects/widgets', wrapperName: 'JectsSelect',
      elementTag: 'jects-select', event: 'change',
      config:
`  placeholder: 'Choose a color',
  value: 'blue',
  options: [
    { value: 'red', label: 'Red' },
    { value: 'blue', label: 'Blue' },
  ],`,
    },
  ],
  richtext: [{
    className: 'RichText', importPath: '@jects/widgets', wrapperName: 'JectsRichText',
    elementTag: 'jects-rich-text', event: 'change',
    config:
`  toolbar: ['bold', 'italic', 'link', 'insertImage', 'insertTable'],
  value: '<p>Edit this <strong>rich</strong> content.</p>',`,
  }],
};

/* snippet generators — pure string templates, one per framework. */
const _cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const _inst = (c) => c.className.charAt(0).toLowerCase() + c.className.slice(1);
/** Add `n` extra spaces to every non-empty line (for re-nesting a config body). */
const _reindent = (body, n) => (n ? body.replace(/^(?=[^\n])/gm, ' '.repeat(n)) : body);

function _snipVanilla(c) {
  const v = _inst(c);
  return `import { ${c.className} } from '${c.importPath}';

const host = document.getElementById('app');

const ${v} = new ${c.className}(host, {
${c.config}
});

${v}.on('${c.event}', (e) => console.log('${c.event}', e));

// Tear down when you're done:
// ${v}.destroy();`;
}
function _snipReact(c) {
  return `import { ${c.wrapperName} } from '@jects/react';

const config = {
${c.config}
};

export function Example() {
  return (
    <${c.wrapperName}
      {...config}
      on${_cap(c.event)}={(e) => console.log('${c.event}', e)}
    />
  );
}`;
}
function _snipVue(c) {
  return `<script setup lang="ts">
import { ${c.wrapperName} } from '@jects/vue';

const config = {
${c.config}
};

function on${_cap(c.event)}(e) {
  console.log('${c.event}', e);
}
</script>

<template>
  <${c.wrapperName} v-bind="config" @${c.event}="on${_cap(c.event)}" />
</template>`;
}
function _snipAngular(c) {
  return `import { Component } from '@angular/core';
import { ${c.wrapperName} } from '@jects/angular';

@Component({
  selector: 'app-example',
  standalone: true,
  imports: [${c.wrapperName}],
  template: \`
    <${c.elementTag}
      [config]="config"
      [events]="['${c.event}']"
      (jectsEvent)="onEvent($event)"
    ></${c.elementTag}>
  \`,
})
export class ExampleComponent {
  config = {
${_reindent(c.config, 2)}
  };

  onEvent(e: { type: string; payload: unknown }) {
    console.log(e.type, e.payload);
  }
}`;
}
function _snipElement(c) {
  const v = _inst(c);
  return `import { register } from '@jects/elements';

// Defines every <jects-*> custom element (idempotent — safe to call once).
register();

const ${v} = document.querySelector('${c.elementTag}');
${v}.config = {
${c.config}
};

${v}.addEventListener('${c.event}', (e) => console.log('${c.event}', e.detail));`;
}
const SNIPPETS = {
  vanilla: _snipVanilla,
  react: _snipReact,
  vue: _snipVue,
  angular: _snipAngular,
  element: _snipElement,
};

/* Build the Code tab panel for a route: a component selector (only when the
   route hosts >1 component), a framework selector, a styled <pre> snippet and a
   Copy button. Snippets regenerate purely from the manifest on every switch. */
function buildCodePanel(id) {
  const comps = CODE_TEMPLATES[id];
  const panel = el('div', { class: 'g-tabpanel g-code-panel', 'data-panel': 'code', role: 'tabpanel' });

  let activeComp = comps[0];
  let activeFw = 'vanilla';

  const codeEl = el('code');
  const pre = el('pre', { class: 'g-code' }, [codeEl]);
  const render = () => { codeEl.textContent = SNIPPETS[activeFw](activeComp); };

  const head = el('div', { class: 'g-code-head' });

  // component sub-selector — only when a route documents more than one component
  if (comps.length > 1) {
    const compSeg = el('div', { class: 'g-seg g-code-comp', role: 'tablist', 'aria-label': 'Component' });
    const compBtns = [];
    comps.forEach((c, i) => {
      const b = el('button', { type: 'button', text: c.className, 'aria-pressed': i === 0 ? 'true' : 'false' });
      b.addEventListener('click', () => {
        activeComp = c;
        compBtns.forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
        render();
      });
      compSeg.appendChild(b);
      compBtns.push(b);
    });
    head.appendChild(compSeg);
  }

  // framework selector
  const fwSeg = el('div', { class: 'g-seg g-code-fw', role: 'tablist', 'aria-label': 'Framework' });
  const fwBtns = {};
  FRAMEWORKS.forEach(([key, label]) => {
    const b = el('button', { type: 'button', text: label, 'aria-pressed': key === activeFw ? 'true' : 'false' });
    b.addEventListener('click', () => {
      activeFw = key;
      for (const k in fwBtns) fwBtns[k].setAttribute('aria-pressed', k === key ? 'true' : 'false');
      render();
    });
    fwSeg.appendChild(b);
    fwBtns[key] = b;
  });
  head.appendChild(fwSeg);

  // copy button
  const copyBtn = el('button', { class: 'g-code-copy', type: 'button', text: 'Copy' });
  copyBtn.addEventListener('click', async () => {
    const text = codeEl.textContent;
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch (_) { /* fall through to legacy path */ }
    if (!ok) {
      try {
        const r = document.createRange();
        r.selectNodeContents(codeEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        ok = document.execCommand('copy');
        sel.removeAllRanges();
      } catch (_) { ok = false; }
    }
    copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
  });

  panel.appendChild(el('p', { class: 'g-lede g-code-lede',
    text: 'Use this component in your stack — pick a framework. Snippets are illustrative; see the Docs tab for the full API.' }));
  panel.appendChild(head);
  panel.appendChild(el('div', { class: 'g-code-figure' }, [
    el('div', { class: 'g-code-bar' }, [copyBtn]),
    pre,
  ]));
  render();
  return panel;
}

/* ── tabbed pages: each route = Demo (existing section) + Code + Docs ─────── */
const PAGES = new Map(); // id -> { page, demoPanel, codePanel, docsPanel, tabBtns, sectionNode, meta, hasDemo }
function buildPage(id) {
  const meta = ROUTE_META[id];
  const sectionNode = SECTION_NODES.get(id) || null;
  const hasDemo = !!sectionNode;
  const hasCode = hasDemo && !!CODE_TEMPLATES[id];
  const page = el('div', { class: 'g-page', id: 'page-' + id });

  const tablist = el('div', { class: 'g-tabs', role: 'tablist' });
  const tabBtns = {};
  const mkTab = (key, label) => {
    const b = el('button', { class: 'g-tab', type: 'button', role: 'tab', 'data-tab': key, text: label });
    b.addEventListener('click', () => { location.hash = key === 'demo' ? '#' + id : '#' + id + '/' + key; });
    tablist.appendChild(b);
    tabBtns[key] = b;
  };
  if (hasDemo) mkTab('demo', 'Demo');
  if (hasCode) mkTab('code', 'Code');
  mkTab('docs', 'Docs');

  const demoPanel = el('div', { class: 'g-tabpanel', 'data-panel': 'demo', role: 'tabpanel' });
  const docsPanel = el('div', { class: 'g-tabpanel g-docs-panel', 'data-panel': 'docs', role: 'tabpanel' });
  const codePanel = hasCode ? buildCodePanel(id) : null;

  if (hasDemo) {
    sectionNode.classList.add('is-active'); // visible inside its panel; the tabpanel governs show/hide
    demoPanel.appendChild(sectionNode);
  } else {
    page.appendChild(el('div', { class: 'g-page-hd' }, [
      el('h2', { text: meta.title }),
      meta.desc ? el('p', { class: 'g-lede', text: meta.desc }) : null,
    ]));
  }

  page.appendChild(tablist);
  if (hasDemo) page.appendChild(demoPanel);
  if (codePanel) page.appendChild(codePanel);
  page.appendChild(docsPanel);

  PAGES.set(id, { page, demoPanel, codePanel, docsPanel, tabBtns, sectionNode, meta, hasDemo });
  return page;
}

/* Rebuild <main> as the ordered set of tabbed pages (sections are MOVED out of
   their original flat position into each page's Demo panel — build fns intact). */
main.replaceChildren();
for (const g of SIDEBAR_GROUPS) for (const id of g.items) main.appendChild(buildPage(id));

/* ── grouped + searchable sidebar ─────────────────────────────────────── */
const searchInput = el('input', { class: 'g-search', type: 'search', placeholder: 'Search components…', 'aria-label': 'Search components' });
const navGroups = el('div', { class: 'g-nav-groups' });
const navLinks = [];   // { a, hay }
const navGroupEls = []; // { groupEl, links }
for (const g of SIDEBAR_GROUPS) {
  const groupEl = el('div', { class: 'g-nav-group' });
  groupEl.appendChild(el('div', { class: 'g-nav-grouphd', text: g.label }));
  const links = [];
  for (const id of g.items) {
    const meta = ROUTE_META[id];
    const a = el('a', { class: 'g-nav-link', href: '#' + id, text: meta.title, 'data-route': id });
    const hay = (meta.title + ' ' + (meta.desc || '') + ' ' + id).toLowerCase();
    groupEl.appendChild(a);
    navLinks.push({ a, hay });
    links.push(a);
  }
  navGroupEls.push({ groupEl, links });
  navGroups.appendChild(groupEl);
}
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  for (const { a, hay } of navLinks) a.style.display = (!q || hay.includes(q)) ? '' : 'none';
  for (const { groupEl, links } of navGroupEls) {
    groupEl.style.display = links.some((a) => a.style.display !== 'none') ? '' : 'none';
  }
});
const nav = el('nav', { class: 'g-nav' }, [searchInput, navGroups]);

/* ── router: page selection + tab, deep-linkable as #id or #id/docs ─────── */
const DEFAULT_ROUTE = SIDEBAR_GROUPS[0].items[0];
function showTab(entry, tab) {
  for (const key of Object.keys(entry.tabBtns)) {
    const sel = key === tab;
    entry.tabBtns[key].classList.toggle('is-active', sel);
    entry.tabBtns[key].setAttribute('aria-selected', sel ? 'true' : 'false');
  }
  entry.demoPanel.classList.toggle('is-active', tab === 'demo');
  if (entry.codePanel) entry.codePanel.classList.toggle('is-active', tab === 'code');
  entry.docsPanel.classList.toggle('is-active', tab === 'docs');
  if (tab === 'demo' && entry.sectionNode) activateSection(entry.sectionNode);
  if (tab === 'docs') loadDocs(entry.meta.doc, entry.docsPanel);
}
function route() {
  // Strip any `?query` suffix (the customizer encodes shared state as
  // `#customizer?cz=…`) before resolving the route id, so shared links still
  // deep-link the right page.
  const raw = (location.hash || '').replace(/^#/, '').split('?')[0];
  const slash = raw.indexOf('/');
  let id = slash >= 0 ? raw.slice(0, slash) : raw;
  let tab = slash >= 0 ? raw.slice(slash + 1) : '';
  if (!PAGES.has(id)) { id = DEFAULT_ROUTE; tab = ''; }
  const entry = PAGES.get(id);
  if (tab !== 'docs' && tab !== 'code') tab = 'demo';
  if (tab === 'code' && !entry.codePanel) tab = 'demo';
  if (!entry.hasDemo) tab = 'docs';
  for (const [pid, e] of PAGES) e.page.classList.toggle('is-active', pid === id);
  for (const { a } of navLinks) a.classList.toggle('is-active', a.getAttribute('data-route') === id);
  main.scrollTop = 0;
  showTab(entry, tab);
}
window.addEventListener('hashchange', route);

/* Theme switcher (Light / Dark / Light HC / Dark HC) via @jects/theme setTheme. */
const THEMES = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['light-hc', 'Light HC'],
  ['dark-hc', 'Dark HC'],
  // Bootstrap-faithful options to compare (one will become the new default).
  ['bootstrap', 'Bootstrap'],
  ['refined', 'Refined'],
  ['corporate', 'Corporate'],
];
const seg = el('div', { class: 'g-seg' });
THEMES.forEach(([value, label], i) => {
  const b = el('button', { type: 'button', text: label, 'aria-pressed': i === 0 ? 'true' : 'false' });
  b.addEventListener('click', () => {
    setTheme(value); // toggles data-jects-theme + .jects-dark / .jects-hc on <html>
    seg.querySelectorAll('button').forEach((n) => n.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', 'true');
  });
  seg.appendChild(b);
});

/* Live primary-color + radius controls → write --jects-* on <html>.
   Colors must be OKLCH triplets (the token contract is OKLCH), so convert. */
function hexToOklchTriplet(hex) {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const [rl, gl, bl] = [lin(r), lin(g), lin(b)];
  // linear sRGB → OKLab
  const l = 0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl;
  const mm = 0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl;
  const s = 0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(mm), s_ = Math.cbrt(s);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.sqrt(A * A + B * B);
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return `${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(1)}`;
}

const colorInput = el('input', { type: 'color', value: '#3b82f6', title: 'Primary color' });
const colorHex = el('input', { type: 'text', class: 'g-topbar-hex', value: '#3b82f6', spellcheck: 'false', maxlength: '7', 'aria-label': 'Primary color hex value' });
const applyPrimary = (hex) => {
  applyTheme(document.documentElement, { primary: hexToOklchTriplet(hex), ring: hexToOklchTriplet(hex) });
};
colorInput.addEventListener('input', () => { colorHex.value = colorInput.value; applyPrimary(colorInput.value); });
colorHex.addEventListener('input', () => {
  let v = colorHex.value.trim(); if (v && v[0] !== '#') v = '#' + v;
  if (/^#[0-9a-fA-F]{3}$/.test(v)) v = '#' + v.slice(1).split('').map((c) => c + c).join('');
  if (/^#[0-9a-fA-F]{6}$/.test(v)) { colorInput.value = v; applyPrimary(v); }
});

const radiusInput = el('input', { type: 'range', min: '0', max: '20', value: '10', title: 'Corner radius' });
radiusInput.addEventListener('input', () => {
  applyTheme(document.documentElement, { radius: radiusInput.value + 'px' });
});

const topbar = el('div', { class: 'g-topbar' }, [
  el('div', { class: 'g-control' }, [el('label', { text: 'Theme' }), seg]),
  el('div', { class: 'g-control' }, [el('label', { text: 'Primary' }), el('span', { class: 'g-colorwrap' }, [colorInput, colorHex])]),
  el('div', { class: 'g-control' }, [el('label', { text: 'Radius' }), radiusInput]),
]);

const brand = el('div', { class: 'g-brand' }, [
  el('span', { class: 'g-dot' }),
  el('span', { text: 'Jects UI' }),
]);

root.appendChild(brand);
root.appendChild(topbar);
root.appendChild(nav);
root.appendChild(main);

// Default theme on load.
setTheme('light');

// Activate the routed page (from the URL hash, or the first section).
route();
