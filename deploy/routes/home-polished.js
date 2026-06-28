/**
 * Route: home — product-grade landing page (default route).
 */
import { el } from '../shell/dom.js';
import { section } from '../shell/registry.js';

const MODULES = [
  ['grid', 'Grid', '@jects/grid', 'Virtual data console'],
  ['gantt', 'Gantt', '@jects/gantt', 'Project planning'],
  ['scheduler', 'Scheduler', '@jects/scheduler', 'Resource dispatch'],
  ['calendar', 'Calendar', '@jects/calendar', 'Multi-view events'],
  ['kanban', 'Kanban', '@jects/kanban', 'Workflow board'],
  ['spreadsheet', 'Spreadsheet', '@jects/spreadsheet', 'Workbook modeling'],
  ['pivot', 'Pivot', '@jects/pivot', 'Cross-tab analytics'],
  ['charts', 'Charts', '@jects/charts', 'Business visuals'],
  ['diagram', 'Diagram', '@jects/diagram', 'Process modeling'],
];

const SOLUTIONS = [
  ['planning-control-center', 'Planning Control Center', 'Gantt · Scheduler · Grid · Risk analytics', 'Plan critical work, inspect dependencies, and see capacity pressure in one application surface.'],
  ['operations-dispatch', 'Operations Dispatch', 'Scheduler · Booking · Calendar', 'Assign unplanned work, respect availability, and expose utilization before the day breaks.'],
  ['analytics-workspace', 'Analytics Workspace', 'Grid · Pivot · Charts · Spreadsheet', 'Move from operational rows to cross-tabs, dashboards, and forecast models without changing UI stacks.'],
  ['workflow-delivery', 'Workflow Delivery', 'Kanban · To-Do · Gantt · Scheduler', 'Connect delivery boards to dated plans, assignments, activity, and execution KPIs.'],
];

const EVAL_STEPS = [
  ['1', 'Run proof', 'Use the live benchmarks and matrix to check scale, bundle cost, tests, and coverage.'],
  ['2', 'Mount one module', 'Start with Grid, Gantt, or Scheduler through a framework subpath import.'],
  ['3', 'Compose a workflow', 'Connect planning, dispatch, analytics, and workflow screens on one theme system.'],
];

function cta(href, label, primary = false) {
  return el('a', { class: 'g-home-cta' + (primary ? ' is-primary' : ''), href, text: label });
}

function proofCard(value, label, note) {
  return el('div', { class: 'g-home-proof-card' }, [
    el('div', { class: 'g-home-proof-value', text: value }),
    el('div', { class: 'g-home-proof-label', text: label }),
    note ? el('div', { class: 'g-home-proof-note', text: note }) : null,
  ]);
}

function previewPanel() {
  const taskRows = [
    ['Discovery', 'Complete', '100%'],
    ['Platform build', 'On track', '68%'],
    ['Integration', 'Capacity risk', '42%'],
    ['Launch', 'Blocked', '18%'],
  ];
  const timeline = [
    ['Research', '12%', '28%', 'ok'],
    ['Build', '33%', '42%', 'ok'],
    ['Integrate', '58%', '24%', 'warn'],
    ['Launch', '82%', '12%', 'risk'],
  ];

  return el('div', { class: 'g-home-preview', 'aria-label': 'Integrated Jects suite preview' }, [
    el('div', { class: 'g-home-preview-top' }, [
      el('div', { class: 'g-home-window-dots', 'aria-hidden': 'true' }, [
        el('span', { class: 'is-red' }), el('span', { class: 'is-yellow' }), el('span', { class: 'is-green' }),
      ]),
      el('div', { class: 'g-home-preview-title', text: 'Enterprise Planning Console' }),
      el('span', { class: 'jects-status-chip', 'data-tone': 'ok', text: 'Live model' }),
    ]),
    el('div', { class: 'g-home-preview-kpis' }, [
      el('div', { class: 'g-home-mini-kpi' }, [el('b', { text: '93%' }), el('span', { text: 'resource fit' })]),
      el('div', { class: 'g-home-mini-kpi' }, [el('b', { text: '7' }), el('span', { text: 'risk items' })]),
      el('div', { class: 'g-home-mini-kpi' }, [el('b', { text: '4.2k' }), el('span', { text: 'tests' })]),
    ]),
    el('div', { class: 'g-home-preview-grid' }, [
      el('div', { class: 'g-home-preview-pane is-table' }, [
        el('div', { class: 'g-home-pane-title', text: 'Work plan' }),
        ...taskRows.map(([name, status, pct]) => el('div', { class: 'g-home-task-row' }, [
          el('span', { text: name }),
          el('em', { text: status }),
          el('b', { text: pct }),
        ])),
      ]),
      el('div', { class: 'g-home-preview-pane is-timeline' }, [
        el('div', { class: 'g-home-pane-title', text: 'Timeline + capacity' }),
        ...timeline.map(([label, left, width, tone]) => el('div', { class: 'g-home-time-row' }, [
          el('span', { text: label }),
          el('div', { class: 'g-home-time-track' }, [
            el('i', { class: 'g-home-time-bar', 'data-tone': tone, style: `left:${left};width:${width}` }),
          ]),
        ])),
      ]),
    ]),
    el('div', { class: 'g-home-preview-footer' }, [
      el('span', { text: 'Grid → Gantt → Scheduler → Pivot → Chart' }),
      el('strong', { text: 'one theme · one API' }),
    ]),
  ]);
}

function solutionCard([id, title, stack, desc]) {
  return el('a', { class: 'g-home-solution', href: '#' + id }, [
    el('span', { class: 'g-home-solution-kicker', text: stack }),
    el('strong', { text: title }),
    el('p', { text: desc }),
    el('span', { class: 'g-home-solution-link', text: 'Open scenario →' }),
  ]);
}

function moduleCard([id, label, pkg, desc]) {
  return el('a', { class: 'g-home-module', href: '#' + id }, [
    el('div', { class: 'g-home-module-top' }, [
      el('div', { class: 'g-home-module-name', text: label }),
      el('div', { class: 'g-home-module-maturity', 'data-pkg': pkg, text: '' }),
    ]),
    el('div', { class: 'g-home-module-desc', text: desc }),
  ]);
}

export function register() {
  section(
    'home',
    'Jects UI',
    null,
    (grid) => {
      grid.classList.add('g-home-shell');
      grid.appendChild(el('section', { class: 'g-home-hero' }, [
        el('div', { class: 'g-home-hero-copy' }, [
          el('div', { class: 'g-home-eyebrow' }, [
            el('span', { class: 'g-home-eyebrow-dot' }),
            el('span', { text: 'Jects UI — enterprise planning and data suite' }),
          ]),
          el('h1', { class: 'g-home-headline', text: 'Build the planning cockpit without stitching five UI stacks together.' }),
          el('p', { class: 'g-home-subhead', text: 'Grid, Gantt, Scheduler, Calendar, Kanban, Pivot, Charts, Spreadsheet, Diagram, Forms, and productivity modules on one TypeScript core, one token system, and one integration model.' }),
          el('div', { class: 'g-home-ctas' }, [
            cta('#planning-control-center', 'Open flagship demo', true),
            cta('#performance', 'Run performance proof'),
            cta('#grid/code', 'Copy starter code'),
          ]),
        ]),
        previewPanel(),
      ]));

      const proofRow = el('div', { class: 'g-home-proof', hidden: 'hidden' });
      grid.appendChild(proofRow);
      const matrixPromise = fetch('./matrix.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error('matrix ' + r.status))));
      matrixPromise.then((m) => {
        const t = (m && m.totals) || {};
        proofRow.replaceChildren(
          proofCard(t.packages != null ? String(t.packages) : '22', 'packages', 'single suite'),
          proofCard(t.unitCases != null ? t.unitCases + '+' : '4k+', 'unit test cases', 'generated matrix'),
          proofCard('4', 'framework wrappers', 'React · Vue · Angular · Web Components'),
          proofCard('Lazy', 'runtime loading', 'route-level JS + CSS'),
        );
        proofRow.removeAttribute('hidden');
      }).catch(() => {});

      grid.appendChild(el('div', { class: 'g-home-sectionhead' }, [
        el('span', { text: 'Flagship solutions' }),
        el('p', { text: 'Application-grade demos that show the suite working as one product.' }),
      ]));
      grid.appendChild(el('div', { class: 'g-home-solutions' }, SOLUTIONS.map(solutionCard)));

      grid.appendChild(el('div', { class: 'g-home-eval' }, [
        el('div', { class: 'g-home-eval-copy' }, [
          el('span', { class: 'g-home-section-kicker', text: 'Evaluation path' }),
          el('h3', { text: 'From proof to production surface.' }),
          el('p', { text: 'The site is structured for buyer confidence: verify scale, mount one module, then compose workflows under the same theme and API conventions.' }),
        ]),
        el('div', { class: 'g-home-eval-steps' }, EVAL_STEPS.map(([n, title, body]) => el('div', { class: 'g-home-eval-step' }, [
          el('span', { text: n }), el('strong', { text: title }), el('p', { text: body }),
        ]))),
      ]));

      grid.appendChild(el('div', { class: 'g-home-sectionhead' }, [
        el('span', { text: 'Module surface' }),
        el('p', { text: 'Core planning, data, workflow, and visualization modules with maturity read from the generated matrix.' }),
      ]));
      const modGrid = el('div', { class: 'g-home-modules' });
      const maturityByPkg = {};
      for (const mod of MODULES) modGrid.appendChild(moduleCard(mod));
      grid.appendChild(modGrid);
      matrixPromise.then((m) => {
        for (const p of (m && m.packages) || []) maturityByPkg[p.name] = p.maturity;
        for (const node of modGrid.querySelectorAll('.g-home-module-maturity')) {
          const mat = maturityByPkg[node.getAttribute('data-pkg')];
          if (!mat) continue;
          node.textContent = mat;
          node.setAttribute('data-maturity', mat.toLowerCase());
        }
      }).catch(() => {});
    },
    { wide: true },
  );
}
