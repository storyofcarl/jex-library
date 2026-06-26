/**
 * Per-component "Code" tab (framework usage). Extracted verbatim from
 * gallery.js. Documentation only — snippets are rendered + copyable, never run.
 */

import { el } from './dom.js';

export const FRAMEWORKS = [
  ['vanilla', 'Vanilla TS'],
  ['react', 'React'],
  ['vue', 'Vue'],
  ['angular', 'Angular'],
  ['element', 'Web Component'],
];

/* route id → one or more component descriptors. */
export const CODE_TEMPLATES = {
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

/* Build the Code tab panel for a route. */
export function buildCodePanel(id) {
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
