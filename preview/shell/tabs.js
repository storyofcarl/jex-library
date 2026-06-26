/**
 * Tabbed pages: each route = Demo (existing section) + Code + Docs.
 * Extracted verbatim from gallery.js.
 */

import { el } from './dom.js';
import { ROUTE_META, SECTION_NODES, activateSection } from './registry.js';
import { CODE_TEMPLATES, buildCodePanel } from './code-panel.js';
import { loadDocs } from './markdown.js';

export const PAGES = new Map(); // id -> { page, demoPanel, codePanel, docsPanel, tabBtns, sectionNode, meta, hasDemo }

export function buildPage(id) {
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

export function showTab(entry, tab) {
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
