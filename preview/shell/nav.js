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

/* ── topbar: theme switcher + live primary-color + radius controls ──────── */
export function buildTopbar() {
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
    el('div', { class: 'g-control' }, [el('label', { text: 'Theme' }), seg]),
    el('div', { class: 'g-control' }, [el('label', { text: 'Primary' }), el('span', { class: 'g-colorwrap' }, [colorInput, colorHex])]),
    el('div', { class: 'g-control' }, [el('label', { text: 'Radius' }), radiusInput]),
  ]);
  return topbar;
}

export function buildBrand() {
  return el('div', { class: 'g-brand' }, [
    el('span', { class: 'g-dot' }),
    el('span', { text: 'Jects UI' }),
  ]);
}

/* ── flagship landing hero (home/landing view only) ─────────────────────── */
export function buildHero() {
  const hero = el('div', { class: 'g-hero', style:
    'border:1px solid oklch(var(--jects-border));border-radius:var(--jects-radius-lg,12px);background:linear-gradient(135deg, oklch(var(--jects-card)), oklch(var(--jects-muted)));padding:2rem 2rem 1.75rem;margin-bottom:1.5rem' });

  hero.appendChild(el('div', {
    style: 'display:inline-flex;align-items:center;gap:.5rem;font-size:.72rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:oklch(var(--jects-muted-foreground));margin-bottom:.6rem' }, [
    el('span', { style: 'width:.55rem;height:.55rem;border-radius:50%;background:oklch(var(--jects-primary))' }),
    el('span', { text: 'Jects UI — the planning-and-data suite' }),
  ]));

  hero.appendChild(el('h1', {
    style: 'margin:0 0 .5rem;font-size:clamp(1.6rem,3.2vw,2.4rem);font-weight:800;line-height:1.12;max-width:22ch',
    text: 'One core. One design language. The whole planning-and-data surface.' }));

  hero.appendChild(el('p', {
    style: 'margin:0 0 1.25rem;max-width:62ch;font-size:1.02rem;line-height:1.6;color:oklch(var(--jects-muted-foreground))',
    text: 'A framework-agnostic, zero-dependency suite — grid, gantt, scheduler, calendar, spreadsheet, pivot, charts, diagrams, boards and more — built on one @jects/core and themed by one OKLCH token system.' }));

  // CTA row.
  const ctaRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:.6rem;margin-bottom:1.5rem' });
  const cta = (href, label, primary) => el('a', {
    href, style:
      'display:inline-flex;align-items:center;gap:.4rem;padding:.6rem 1.05rem;border-radius:var(--jects-radius-md,8px);font-size:.9rem;font-weight:600;text-decoration:none;border:1px solid oklch(var(--jects-border));'
      + (primary
        ? 'background:oklch(var(--jects-primary));color:oklch(var(--jects-primary-foreground));border-color:oklch(var(--jects-primary))'
        : 'background:oklch(var(--jects-card));color:oklch(var(--jects-foreground))'),
    text: label });
  ctaRow.appendChild(cta('#performance', 'See it perform', true));
  ctaRow.appendChild(cta('#compare', 'How it compares', false));
  ctaRow.appendChild(cta('#grid', 'Explore the Grid', false));
  hero.appendChild(ctaRow);

  // Differentiator cards.
  const diffs = [
    ['One zero-dependency core', 'Every module sits on a single @jects/core — Widget, Store/TreeStore, signals, virtualization, factory.'],
    ['One OKLCH token system', 'A 3-tier OKLCH token contract as CSS variables, plus a live customizer that themes the entire suite.'],
    ['Framework-agnostic API', 'Light-DOM imperative classes with thin official React/Vue/Angular/Web-Component wrappers over the same API.'],
    ['Per-component subpath exports', 'Stable new Ctor(host, cfg) packaging — install and ship only what you import.'],
  ];
  const cards = el('div', { class: 'g-grid', style: 'gap:.75rem' },
    diffs.map(([t, d]) => el('div', {
      style: 'border:1px solid oklch(var(--jects-border));border-radius:var(--jects-radius-md,8px);background:oklch(var(--jects-card));padding:.85rem 1rem' }, [
      el('div', { style: 'font-weight:700;font-size:.92rem;margin-bottom:.3rem', text: t }),
      el('div', { style: 'font-size:.82rem;line-height:1.5;color:oklch(var(--jects-muted-foreground))', text: d }),
    ])));
  hero.appendChild(cards);
  return hero;
}
