/**
 * Hash router: page selection + tab, deep-linkable as #id or #id/docs.
 * Extracted verbatim from gallery.js (route()), parameterized over the shell
 * pieces it touches (the nav links + hero element + the <main> scroll target).
 */

import { PAGES, showTab } from './tabs.js';

/* The product landing page is the default route. `home` registers its own
   section (see routes/home.js) and owns its hero content, so the shell no
   longer renders a separate chrome hero. */
export const DEFAULT_ROUTE = 'home';

/**
 * Wire the hash router. `navLinks` is the sidebar link list from buildNav();
 * `main` is the scrollable <main> element.
 * Returns the `route` function (also registers the hashchange listener).
 */
export function createRouter({ navLinks, main }) {
  function route() {
    // Strip any `?query` suffix (the customizer encodes shared state as
    // `#customizer?cz=…`) before resolving the route id, so shared links still
    // deep-link the right page.
    const raw = (location.hash || '').replace(/^#/, '').split('?')[0];
    const slash = raw.indexOf('/');
    let id = slash >= 0 ? raw.slice(0, slash) : raw;
    let tab = slash >= 0 ? raw.slice(slash + 1) : '';
    if (!PAGES.has(id)) { id = DEFAULT_ROUTE; tab = ''; }
    const entry = PAGES.get(id);
    if (tab !== 'docs' && tab !== 'code') tab = 'demo';
    if (tab === 'code' && !entry.codePanel) tab = 'demo';
    if (!entry.hasDemo) tab = 'docs';
    for (const [pid, e] of PAGES) e.page.classList.toggle('is-active', pid === id);
    for (const { a } of navLinks) a.classList.toggle('is-active', a.getAttribute('data-route') === id);
    main.scrollTop = 0;
    showTab(entry, tab);
  }
  window.addEventListener('hashchange', route);
  return route;
}
