/**
 * Shell chrome: grouped + searchable sidebar, the topbar (theme switcher +
 * primary / radius controls), the brand mark, and the flagship landing hero.
 * Extracted verbatim from gallery.js.
 */

import { el } from './dom.js';
import { setTheme, applyTheme } from '@jects/theme';
import { ROUTE_META, SIDEBAR_GROUPS } from './registry.js';

/* Live primary-color + radius controls → write --jects-* on <html>.
   Colors must be OKLCH triplets (the token contract is OKLCH), so convert. */
export function hexToOklchTriplet(hex) {
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

/* ── grouped + searchable sidebar ─────────────────────────────────────── */
export function buildNav() {
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
  return { nav, navLinks };
}

/* The framework switch → the import line it produces for @jects/grid. */
const INSTALL_CMD = 'pnpm add @jects/grid @jects/theme';
const FRAMEWORK_IMPORTS = [
  ['Vanilla', "import { Grid } from '@jects/grid';"],
  ['React', "import { JectsGrid } from '@jects/react/grid';"],
  ['Vue', "import { JectsGrid } from '@jects/vue/grid';"],
  ['Angular', "import { JectsGridComponent } from '@jects/angular/grid';"],
  ['Web Component', "import '@jects/elements/grid'; // <jects-grid>"],
];

/* ── topbar: adoption funnel + install affordance + theme/primary/radius ─── */
export function buildTopbar() {
  /* Mobile nav toggle (hamburger) — shown ≤900px via CSS; wired in app.js. */
  const navToggle = el('button', {
    type: 'button', class: 'g-nav-toggle', 'aria-label': 'Toggle navigation',
    'aria-expanded': 'false', text: '☰',
  });

  /* Adoption-funnel primary navigation. */
  const FUNNEL = [
    ['Start', '#home'],
    ['Docs', '#grid/docs'],
    ['Examples', '#flow-analytics'],
    ['Performance', '#performance'],
    ['Comparison', '#compare'],
  ];
  const funnel = el('nav', { class: 'g-funnel', 'aria-label': 'Primary' },
    FUNNEL.map(([label, href]) => el('a', { class: 'g-funnel-link', href, text: label })));

  /* "Copy install" affordance with a framework switch that rewrites the line. */
  const fwSeg = el('div', { class: 'g-seg g-fw-seg' });
  const installCode = el('code', { class: 'g-install-code', text: INSTALL_CMD });
  let copiedTimer = null;
  const copyBtn = el('button', { type: 'button', class: 'g-install-copy', 'aria-label': 'Copy install command', text: 'Copy' });
  copyBtn.addEventListener('click', () => {
    const text = installCode.textContent;
    const done = () => {
      copyBtn.textContent = 'Copied';
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1400);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => {});
      } else { done(); }
    } catch (_) { /* clipboard unavailable — ignore */ }
  });
  FRAMEWORK_IMPORTS.forEach(([label, imp], i) => {
    const b = el('button', { type: 'button', text: label, 'aria-pressed': i === 0 ? 'true' : 'false', title: label });
    b.addEventListener('click', () => {
      fwSeg.querySelectorAll('button').forEach((n) => n.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      installCode.textContent = i === 0 ? INSTALL_CMD : imp;
    });
    fwSeg.appendChild(b);
  });
  const install = el('div', { class: 'g-install' }, [
    fwSeg,
    el('span', { class: 'g-install-line' }, [installCode, copyBtn]),
  ]);

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
    navToggle,
    funnel,
    install,
    el('div', { class: 'g-topbar-spacer' }),
    el('div', { class: 'g-control' }, [el('label', { text: 'Theme' }), seg]),
    el('div', { class: 'g-control' }, [el('label', { text: 'Primary' }), el('span', { class: 'g-colorwrap' }, [colorInput, colorHex])]),
    el('div', { class: 'g-control' }, [el('label', { text: 'Radius' }), radiusInput]),
  ]);
  return { topbar, navToggle };
}

export function buildBrand() {
  return el('div', { class: 'g-brand' }, [
    el('span', { class: 'g-dot' }),
    el('span', { text: 'Jects UI' }),
  ]);
}
