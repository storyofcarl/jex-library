/**
 * Enterprise-scale affordance for the heavy modules. Extracted verbatim from
 * the original gallery.js.
 */

import { el } from './dom.js';
import { Button } from './registry.js';

/**
 * Adds a PRIMARY toolbar button that swaps the demo to a large, realistic
 * dataset — built LAZILY by `build(bigHost)` on first click (never at module
 * load). The original small demo is left mounted (just hidden) so first paint
 * stays fast; the button toggles back. Token-only chrome.
 *
 *   bar        — toolbar element the button + count label mount into
 *   smallHost  — the existing demo's host element (hidden while enterprise is up)
 *   key        — stable id (matches the route) used for the data attr + harness
 *   count      — human label, e.g. "100,000 rows"
 *   build      — pure builder; receives the (correctly sized) big host
 *   status     — optional status-line setter
 */
export function enterpriseSwap(bar, smallHost, { key, count, build, status, alsoHide = [] }) {
  let bigHost = null;
  let built = false;
  let showing = false;
  const idle = 'Load enterprise dataset · ' + count;
  const tag = el('span', { class: 'g-note', style: 'margin-left:.5rem;align-self:center' });
  const btn = new Button(bar, { text: idle, variant: 'primary', size: 'sm', icon: 'arrow-down' });
  btn.el.setAttribute('data-enterprise', key);
  bar.appendChild(tag);
  // Remember each sibling's original display so "Back to demo" restores it.
  const hideMemo = alsoHide.map((node) => [node, node.style.display]);

  btn.el.addEventListener('click', async () => {
    showing = !showing;
    if (!showing) {
      if (bigHost) bigHost.style.display = 'none';
      smallHost.style.display = '';
      hideMemo.forEach(([node, disp]) => { node.style.display = disp; });
      btn.el.textContent = idle;
      return;
    }
    hideMemo.forEach(([node]) => { node.style.display = 'none'; });
    if (!bigHost) {
      bigHost = el('div');
      bigHost.className = smallHost.className;
      const st = smallHost.getAttribute('style');
      if (st) bigHost.setAttribute('style', st);
      smallHost.insertAdjacentElement('afterend', bigHost);
    }
    smallHost.style.display = 'none';
    bigHost.style.display = '';
    btn.el.textContent = 'Back to demo';
    if (built) return;

    const loading = el('div', { class: 'g-loading', role: 'status' }, [
      el('div', { class: 'g-spinner', 'aria-hidden': 'true' }),
      el('div', { text: 'Building ' + count + '…' }),
    ]);
    bigHost.appendChild(loading);
    // Two RAFs so the loading state actually paints before the (blocking) build.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    loading.remove();
    const t0 = performance.now();
    try {
      build(bigHost);
      built = true;
      const ms = Math.round(performance.now() - t0);
      tag.textContent = count + ' · built in ' + ms + ' ms';
      if (status) status('Loaded enterprise dataset: ' + count + ' (' + ms + ' ms).');
      (window.__JECTS_ENTERPRISE__ || (window.__JECTS_ENTERPRISE__ = {}))[key] = { count, ms };
    } catch (e) {
      bigHost.appendChild(el('div', { class: 'g-note', style: 'color:oklch(var(--jects-destructive))', text: 'Enterprise build failed: ' + (e && e.message) }));
      console.error('[gallery] enterprise "' + key + '" failed:', e);
    }
  });
  return btn;
}
