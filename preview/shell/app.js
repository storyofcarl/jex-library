/**
 * Bootstrap: build the shell DOM, register every route's section scaffold,
 * assemble the tabbed pages + sidebar + topbar, wire the router, and kick off
 * the default route.
 *
 * Route-module contract — each route module exports:
 *
 *     export function register() { … }   // calls section(id, …) from registry
 *
 * register() runs EAGERLY at bootstrap and only registers the lightweight
 * section scaffold (its demo `build` closure is deferred). The heavy @jects/*
 * module import + demo build stay lazy, driven by activateSection() on first
 * activation — exactly as in the original monolith. The shared theme module is
 * eager (the shell chrome needs it synchronously).
 */

import { setTheme } from '@jects/theme';
import { el } from './dom.js';
import { SIDEBAR_GROUPS } from './registry.js';
import { buildPage } from './tabs.js';
import { buildNav, buildTopbar, buildBrand } from './nav.js';
import { createRouter } from './router.js';

/**
 * Start the gallery.
 * @param {Record<string, () => Promise<{ register: Function } | { default: Function }>>} routeTable
 *   id → dynamic importer for that route module. Every routed id (from
 *   SIDEBAR_GROUPS, excluding docs-only entries) must be present.
 */
export async function start(routeTable) {
  const root = document.getElementById('gallery');
  const main = el('main', { class: 'g-main' });

  // Register every route's section scaffold EAGERLY (so SECTION_NODES is fully
  // populated before the sidebar + pages are built). Modules are dynamically
  // imported here; the demo builds inside each section stay deferred.
  await Promise.all(
    Object.values(routeTable).map(async (load) => {
      const mod = await load();
      const reg = mod.register || mod.default;
      if (typeof reg === 'function') reg();
    }),
  );

  // Rebuild <main> as the ordered set of tabbed pages (sections are MOVED out of
  // their flat registration into each page's Demo panel — build fns intact).
  // The landing hero now lives inside the `home` route's section, so the shell
  // no longer prepends a separate chrome hero.
  main.replaceChildren();
  for (const g of SIDEBAR_GROUPS) for (const id of g.items) main.appendChild(buildPage(id));

  // Sidebar + topbar + brand.
  const { nav, navLinks } = buildNav();
  const { topbar, navToggle } = buildTopbar();
  const brand = buildBrand();

  // Off-canvas drawer backdrop (mobile). Clicking it closes the drawer.
  const backdrop = el('div', { class: 'g-nav-backdrop', 'aria-hidden': 'true' });
  const closeNav = () => { nav.classList.remove('is-open'); backdrop.classList.remove('is-open'); navToggle.setAttribute('aria-expanded', 'false'); };
  const openNav = () => { nav.classList.add('is-open'); backdrop.classList.add('is-open'); navToggle.setAttribute('aria-expanded', 'true'); };
  navToggle.addEventListener('click', () => { (nav.classList.contains('is-open') ? closeNav : openNav)(); });
  backdrop.addEventListener('click', closeNav);
  // Tapping any sidebar link closes the drawer on mobile.
  for (const { a } of navLinks) a.addEventListener('click', closeNav);

  root.appendChild(brand);
  root.appendChild(topbar);
  root.appendChild(nav);
  root.appendChild(backdrop);
  root.appendChild(main);

  // Default theme on load.
  setTheme('light');

  // Wire the router + activate the routed page (from the URL hash, or default).
  const route = createRouter({ navLinks, main });
  // Close the drawer whenever the route changes (e.g. via topbar funnel links).
  window.addEventListener('hashchange', closeNav);
  route();
}
