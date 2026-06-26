/**
 * Route: home — the product landing / overview page (default route).
 *
 * A wide section that answers, in the first viewport at 1440px: what Jects is,
 * why it's credible (real numbers fetched at runtime from ./matrix.json), and
 * where to click first. Pure DOM/CSS + house tokens — no @jects component
 * module, so it has no SECTION_LOADER and builds instantly.
 */
import { el } from '../shell/dom.js';
import { section } from '../shell/registry.js';

/* Modules surfaced in the compact module grid → their matrix.json package name. */
const MODULES = [
  ['grid', 'Grid', '@jects/grid'],
  ['gantt', 'Gantt', '@jects/gantt'],
  ['scheduler', 'Scheduler', '@jects/scheduler'],
  ['calendar', 'Calendar', '@jects/calendar'],
  ['kanban', 'Kanban', '@jects/kanban'],
  ['spreadsheet', 'Spreadsheet', '@jects/spreadsheet'],
  ['pivot', 'Pivot', '@jects/pivot'],
  ['charts', 'Charts', '@jects/charts'],
  ['diagram', 'Diagram', '@jects/diagram'],
];

export function register() {
  section(
    'home',
    'Jects UI',
    null,
    (grid) => {
      /* ── Hero ─────────────────────────────────────────────────────────── */
      const hero = el('div', { class: 'g-home-hero' });

      hero.appendChild(el('div', { class: 'g-home-eyebrow' }, [
        el('span', { class: 'g-home-eyebrow-dot' }),
        el('span', { text: 'Jects UI — the planning-and-data suite' }),
      ]));

      hero.appendChild(el('h1', { class: 'g-home-headline',
        text: 'One core. One design language. The whole planning-and-data surface.' }));

      hero.appendChild(el('p', { class: 'g-home-subhead',
        text: 'A framework-agnostic, zero-dependency suite themed by one OKLCH token system.' }));

      const ctaRow = el('div', { class: 'g-home-ctas' });
      const cta = (href, label, primary) => el('a', {
        class: 'g-home-cta' + (primary ? ' is-primary' : ''), href, text: label });
      ctaRow.appendChild(cta('#performance', 'See it perform', true));
      ctaRow.appendChild(cta('#compare', 'How it compares', false));
      ctaRow.appendChild(cta('#grid', 'Explore the Grid', false));
      hero.appendChild(ctaRow);

      grid.appendChild(hero);

      /* ── Proof cards — REAL numbers fetched at runtime from ./matrix.json ── */
      const proofRow = el('div', { class: 'g-home-proof', hidden: 'hidden' });
      grid.appendChild(proofRow);

      const proofCard = (value, label) => el('div', { class: 'g-home-proof-card' }, [
        el('div', { class: 'g-home-proof-value', text: value }),
        el('div', { class: 'g-home-proof-label', text: label }),
      ]);

      // matrix.json is served alongside the gallery (page-relative, like docs-content).
      fetch('./matrix.json')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('matrix ' + r.status))))
        .then((m) => {
          const t = (m && m.totals) || {};
          if (t.packages == null && t.unitCases == null) return; // nothing credible to show
          const cards = [];
          if (t.packages != null) cards.push(proofCard(String(t.packages), 'packages'));
          if (t.unitCases != null) cards.push(proofCard(t.unitCases + '+', 'unit test cases'));
          cards.push(proofCard('React · Vue · Angular · Web Components', 'framework wrappers'));
          cards.push(proofCard('Route-lazy JS + CSS', 'loaded only when used'));
          proofRow.replaceChildren(...cards);
          proofRow.removeAttribute('hidden');
        })
        .catch(() => { /* hide gracefully — proofRow stays hidden, no broken UI */ });

      /* ── Compact module grid ──────────────────────────────────────────── */
      grid.appendChild(el('div', { class: 'g-home-sectionhd', text: 'Modules' }));
      const modGrid = el('div', { class: 'g-home-modules' });
      const maturityByPkg = {};
      for (const [id, label, pkg] of MODULES) {
        const a = el('a', { class: 'g-home-module', href: '#' + id }, [
          el('div', { class: 'g-home-module-name', text: label }),
          el('div', { class: 'g-home-module-maturity', 'data-pkg': pkg, text: '' }),
        ]);
        modGrid.appendChild(a);
      }
      grid.appendChild(modGrid);

      // Fill module maturity from the same matrix.json (best-effort; blank if unavailable).
      fetch('./matrix.json')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('matrix ' + r.status))))
        .then((m) => {
          for (const p of (m && m.packages) || []) maturityByPkg[p.name] = p.maturity;
          for (const node of modGrid.querySelectorAll('.g-home-module-maturity')) {
            const mat = maturityByPkg[node.getAttribute('data-pkg')];
            if (mat) node.textContent = mat;
          }
        })
        .catch(() => { /* leave maturity blank on failure */ });
    },
    { wide: true },
  );
}
