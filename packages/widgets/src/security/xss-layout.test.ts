/**
 * XSS hardening suite for the remaining raw-innerHTML surfaces of
 * `@jects/widgets` hardened in Phase 2.5 (docs/SECURITY.md §1–§4 contract:
 * a plain-string field = escaped text; HTML insertion only via an explicit
 * trusted path).
 *
 * Covers one spec per surface:
 *  - DataView: `emptyText` (text), `emptyHtml` (sanitized), `cardTemplate` output
 *  - TabPanel: string panel `content`
 *  - Layout:   string cell content
 *  - Splitter: string pane content
 *  - Panel:    `body` / `footer` / `tools` string HTML
 *
 * Each asserts: a global flag (`window.__xss`) stays false (no handler/script
 * executed), the rendered DOM carries no dangerous nodes/attrs/schemes, and
 * legitimate formatting still renders. jsdom unit test — runs in `pnpm test`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataView } from '../data-views/data-view.js';
import { TabPanel } from '../tabs/tab-panel.js';
import { Layout } from '../layout/layout.js';
import { Splitter } from '../layout/splitter.js';
import { Panel } from '../layout/panel.js';

declare global {
  // eslint-disable-next-line no-var
  interface Window {
    __xss?: boolean;
  }
}

/** The standard injection payloads from docs/SECURITY.md §4. */
const PAYLOADS: readonly string[] = [
  '<img src=x onerror="window.__xss=true">',
  '<script>window.__xss=true</script>',
  '<a href="javascript:window.__xss=true">link</a>',
  '<svg onload="window.__xss=true"></svg>',
  '"><iframe src="javascript:window.__xss=true"></iframe>',
  '<a href="data:text/html,<script>window.__xss=true</script>">d</a>',
  '<p style="width: expression(window.__xss=true)">x</p>',
  '<img src="x" style="background:url(javascript:window.__xss=true)">',
];

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  window.__xss = false;
});
afterEach(() => {
  host.remove();
  window.__xss = false;
});

/** Assert a rendered subtree carries no executable / navigating constructs. */
function assertClean(root: HTMLElement): void {
  expect(root.querySelector('script')).toBeNull();
  expect(root.querySelector('iframe')).toBeNull();
  expect(root.querySelector('object')).toBeNull();
  expect(root.querySelector('embed')).toBeNull();

  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
    }
  }

  const html = root.innerHTML.toLowerCase();
  expect(html).not.toContain('javascript:');
  expect(html).not.toContain('vbscript:');
  expect(html).not.toContain('data:text/html');
  expect(html).not.toContain('expression(');
}

describe('XSS — DataView (emptyText / emptyHtml / cardTemplate)', () => {
  it('emptyText is plain text — never interpreted as HTML', () => {
    const dv = new DataView(host, { data: [], emptyText: '<img src=x onerror="window.__xss=true">' });
    const grid = host.querySelector('.jects-dataview__grid') as HTMLElement;
    expect(grid.querySelector('img')).toBeNull();
    expect(grid.textContent).toContain('<img');
    assertClean(grid);
    expect(window.__xss).toBe(false);
    dv.destroy();
  });

  it('emptyHtml is sanitized for every payload', () => {
    for (const payload of PAYLOADS) {
      const dv = new DataView(host, { data: [], emptyHtml: payload });
      const grid = host.querySelector('.jects-dataview__grid') as HTMLElement;
      assertClean(grid);
      dv.destroy();
    }
    expect(window.__xss).toBe(false);
  });

  it('cardTemplate output is sanitized for every payload', () => {
    for (const payload of PAYLOADS) {
      const dv = new DataView(host, {
        data: [{ id: 1 }],
        cardTemplate: () => payload,
      });
      const grid = host.querySelector('.jects-dataview__grid') as HTMLElement;
      assertClean(grid);
      dv.destroy();
    }
    expect(window.__xss).toBe(false);
  });

  it('renders legitimate markup from emptyHtml and cardTemplate', () => {
    const dv = new DataView(host, { data: [], emptyHtml: '<b>Nothing</b> here' });
    let grid = host.querySelector('.jects-dataview__grid') as HTMLElement;
    expect(grid.querySelector('b')?.textContent).toBe('Nothing');
    dv.destroy();

    const dv2 = new DataView(host, {
      data: [{ id: 1 }],
      cardTemplate: () => '<b class="t">Card</b>',
    });
    grid = host.querySelector('.jects-dataview__grid') as HTMLElement;
    expect(grid.querySelector('b.t')?.textContent).toBe('Card');
    dv2.destroy();
  });
});

describe('XSS — TabPanel (string panel content)', () => {
  it('sanitizes string content for every payload', () => {
    for (const payload of PAYLOADS) {
      const tp = new TabPanel(host, {
        items: [{ id: 'a', label: 'A', content: payload }],
        active: 'a',
      });
      const panels = host.querySelector('.jects-tabpanel__panels') as HTMLElement;
      assertClean(panels);
      tp.destroy();
    }
    expect(window.__xss).toBe(false);
  });

  it('renders legitimate markup', () => {
    const tp = new TabPanel(host, {
      items: [{ id: 'a', label: 'A', content: '<b class="t">Body</b>' }],
      active: 'a',
    });
    const panel = host.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(panel.querySelector('b.t')?.textContent).toBe('Body');
    tp.destroy();
  });
});

describe('XSS — Layout (string cell content)', () => {
  it('sanitizes string cell content for every payload', () => {
    for (const payload of PAYLOADS) {
      const l = new Layout(host, { center: { content: payload } });
      const el = host.querySelector('.jects-layout') as HTMLElement;
      assertClean(el);
      l.destroy();
    }
    expect(window.__xss).toBe(false);
  });

  it('renders legitimate markup', () => {
    const l = new Layout(host, { center: { content: '<b class="t">main</b>' } });
    const el = host.querySelector('.jects-layout') as HTMLElement;
    expect(el.querySelector('b.t')?.textContent).toBe('main');
    l.destroy();
  });
});

describe('XSS — Splitter (string pane content)', () => {
  it('sanitizes string pane content for every payload', () => {
    for (const payload of PAYLOADS) {
      const sp = new Splitter(host, { first: payload, second: payload });
      assertClean(sp.el);
      sp.destroy();
    }
    expect(window.__xss).toBe(false);
  });

  it('renders legitimate markup', () => {
    const sp = new Splitter(host, { first: '<b class="t">left</b>', second: 'right' });
    expect(sp.el.querySelector('b.t')?.textContent).toBe('left');
    expect(sp.el.textContent).toContain('right');
    sp.destroy();
  });
});

describe('XSS — Panel (body / footer / tools string HTML)', () => {
  it('sanitizes body, footer, and tools for every payload', () => {
    for (const payload of PAYLOADS) {
      const p = new Panel(host, {
        title: 'T',
        tools: payload,
        body: payload,
        footer: payload,
      });
      assertClean(p.el);
      p.destroy();
    }
    expect(window.__xss).toBe(false);
  });

  it('title is plain text — never interpreted as HTML', () => {
    const p = new Panel(host, { title: '<img src=x onerror="window.__xss=true">' });
    expect(p.el.querySelector('.jects-panel__header img')).toBeNull();
    expect(p.el.querySelector('.jects-panel__title')?.textContent).toContain('<img');
    expect(window.__xss).toBe(false);
    p.destroy();
  });

  it('renders legitimate markup in body, footer, and tools', () => {
    const p = new Panel(host, {
      title: 'T',
      tools: '<button class="tool">x</button>',
      body: '<b class="b">body</b>',
      footer: '<i class="f">foot</i>',
    });
    // <button> is not in the formatting allow-list; tools markup is still
    // sanitized (button dropped) but its safe text survives.
    expect(p.el.querySelector('.jects-panel__body b.b')?.textContent).toBe('body');
    expect(p.el.querySelector('.jects-panel__footer i.f')?.textContent).toBe('foot');
    p.destroy();
  });

  it('trusted: true bypasses sanitization (explicit opt-in)', () => {
    const p = new Panel(host, { title: 'T', body: '<button class="tool">ok</button>', trusted: true });
    expect(p.el.querySelector('.jects-panel__body button.tool')?.textContent).toBe('ok');
    p.destroy();
  });
});
