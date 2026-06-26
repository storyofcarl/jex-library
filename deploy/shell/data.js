/**
 * Shared demo datasets + generators + constants. Extracted verbatim from the
 * original gallery.js.
 */

/* ───────────────────────── shared demo data ──────────────────────────── */

export const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
export const colors = [
  { value: 'red', label: 'Red' },
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
  { value: 'violet', label: 'Violet', disabled: true },
];
export const fruits = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
  { value: 'date', label: 'Date' },
  { value: 'elderberry', label: 'Elderberry' },
];
export const plans = [
  { value: 'free', label: 'Free' },
  { value: 'pro', label: 'Pro' },
  { value: 'team', label: 'Team' },
];

export const fileTree = [
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

export const people = Array.from({ length: 9 }, (_, i) => ({
  id: i + 1,
  text: `Person ${i + 1}`,
  role: i % 2 ? 'Engineer' : 'Designer',
}));

/* Shared timing constants + the flat sales dataset. */
export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const sales = [
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

export const FIRST_NAMES = ['Ada', 'Alan', 'Grace', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Ken',
  'Edsger', 'Donald', 'John', 'Katherine', 'Tim', 'Radia', 'Vint', 'Hedy', 'Shafi', 'Leslie'];
export const LAST_NAMES = ['Lovelace', 'Turing', 'Hopper', 'Torvalds', 'Hamilton', 'Ritchie', 'Liskov',
  'Thompson', 'Dijkstra', 'Knuth', 'McCarthy', 'Johnson', 'Berners-Lee', 'Perlman', 'Cerf', 'Lamarr'];
export const DEPTS = ['Engineering', 'Design', 'Product', 'Research', 'Sales', 'Marketing', 'Finance', 'Support'];
export const STATUSES = ['Active', 'On leave', 'Probation', 'Contractor', 'Notice'];

/** Grid: N realistic employee rows (id · name · dept · status · salary · hire date · progress). */
export function genGridRows(n) {
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
export function genPivotRecords(n) {
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
export function genGanttProject(leafCount) {
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
export function genSchedulerData(resCount, perRes) {
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
export function genBudgetSheet(rowCount) {
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
export function genKanbanCards(n, columnIds, laneIds) {
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
export function genDiagramGraph(n) {
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
