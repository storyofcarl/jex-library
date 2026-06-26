/**
 * Jects UI — interactive component gallery (thin bootstrap).
 *
 * Runs entirely against the already-built `dist/` ESM bundles (resolved via the
 * import map in index.html). No build step, no install. Every card instantiates
 * a live, interactive component: `new Cmp(hostEl, config)`.
 *
 * This file is now a thin bootstrap. The monolith was split into:
 *   - shell/   — bootstrap, router, registry substrate, tabs, nav, markdown,
 *                code panel, shared data, export-menu + enterprise helpers
 *   - routes/  — one module per routed component/page (each exports register())
 *   - workflows/ — the cross-module flow demos + the realtime board
 *
 * The route table below maps each route id → a lazy dynamic import() of its
 * module. The shared @jects/* component modules stay lazy too (loaded per route
 * on first activation via the registry's SECTION_LOADERS + activateSection),
 * exactly as before — only the section SCAFFOLDS register up front so the
 * sidebar + tabbed pages can be built.
 */

import { start } from './shell/app.js';

/* id → () => import('<module>'). Every routed id from SIDEBAR_GROUPS that has a
   live demo (i.e. is NOT a docsOnly entry) appears here. The docs-only routes
   (core, theme, icons, widgets, timeline-core) have no section and are handled
   by ROUTE_META alone in the page builder. */
const ROUTES = {
  // Start
  home: () => import('./routes/home.js'),
  // Foundation / theme
  foundations: () => import('./routes/foundations.js'),
  customizer: () => import('./routes/customizer.js'),
  // Data
  grid: () => import('./routes/grid.js'),
  pivot: () => import('./routes/pivot.js'),
  spreadsheet: () => import('./routes/spreadsheet.js'),
  // Scheduling
  gantt: () => import('./routes/gantt.js'),
  scheduler: () => import('./routes/scheduler.js'),
  calendar: () => import('./routes/calendar.js'),
  booking: () => import('./routes/booking.js'),
  // Boards & Tasks
  kanban: () => import('./routes/kanban.js'),
  todo: () => import('./routes/todo.js'),
  charts: () => import('./routes/charts.js'),
  diagram: () => import('./routes/diagram.js'),
  // Widgets & Chat
  buttons: () => import('./routes/buttons.js'),
  inputs: () => import('./routes/inputs.js'),
  forms: () => import('./routes/forms.js'),
  layout: () => import('./routes/layout.js'),
  navigation: () => import('./routes/navigation.js'),
  overlays: () => import('./routes/overlays.js'),
  richtext: () => import('./routes/richtext.js'),
  chatbot: () => import('./routes/chatbot.js'),
  // Solutions — flagship application demos
  'planning-control-center': () => import('./workflows/planning-control-center.js'),
  'operations-dispatch': () => import('./workflows/operations-dispatch.js'),
  'analytics-workspace': () => import('./workflows/analytics-workspace.js'),
  'workflow-delivery': () => import('./workflows/workflow-delivery.js'),
  // Integrated workflows
  'flow-analytics': () => import('./workflows/flow-analytics.js'),
  'flow-planning': () => import('./workflows/flow-planning.js'),
  'flow-data': () => import('./workflows/flow-data.js'),
  // Live
  realtime: () => import('./workflows/realtime.js'),
  // Proof
  performance: () => import('./routes/performance.js'),
  a11y: () => import('./routes/a11y.js'),
  'server-data': () => import('./routes/server-data.js'),
  compare: () => import('./routes/compare.js'),
};

start(ROUTES);
