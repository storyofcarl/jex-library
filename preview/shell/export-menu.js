/**
 * Reusable UI affordances: the "Export ▾" dropdown helper + the overlay
 * trigger-button helper. Extracted verbatim from the original gallery.js.
 */

import { el } from './dom.js';
import { Button } from './registry.js';

/** A button that triggers an overlay/imperative demo. */
export function triggerBtn(text, onClick, variant = 'secondary') {
  const host = el('span');
  const b = new Button(host, { text, variant });
  b.el.addEventListener('click', onClick);
  return host;
}

/**
 * A single, reusable "Export ▾" split-format dropdown. Collapses N separate
 * export/print toolbar buttons into one accessible menu. Token-only chrome.
 *
 *   bar    — toolbar element the trigger mounts into (appended for you)
 *   items  — [{ label, onClick }, …]
 *   opts   — { label = 'Export', variant = 'secondary', size = 'sm' }
 */
export function exportMenu(bar, items, opts = {}) {
  const { label = 'Export', variant = 'secondary', size = 'sm' } = opts;
  const wrap = el('div', { class: 'g-exportmenu' });
  // Plain <button> styled with the house btn classes so this works in every
  // section regardless of whether the lazy Button class has loaded yet.
  const btn = el('button', {
    type: 'button',
    class: 'jects-btn jects-btn--' + variant + (size ? ' jects-btn--' + size : ''),
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    text: label + ' ▾',
  });
  wrap.appendChild(btn);

  const menu = el('div', { class: 'g-exportmenu__panel', role: 'menu', hidden: 'hidden' });
  const itemEls = items.map((it, i) => {
    const mi = el('button', {
      class: 'g-exportmenu__item', type: 'button', role: 'menuitem', tabindex: '-1', text: it.label,
    });
    mi.addEventListener('click', () => {
      close(true);
      try { it.onClick(); } catch (e) { console.warn('exportMenu item "' + it.label + '" failed:', e && e.message); }
    });
    menu.appendChild(mi);
    return mi;
  });
  wrap.appendChild(menu);
  if (bar) bar.appendChild(wrap);

  let open = false;
  const focusItem = (i) => {
    if (!itemEls.length) return;
    const n = (i + itemEls.length) % itemEls.length;
    itemEls[n].focus();
  };
  const onDocPointer = (e) => { if (!wrap.contains(e.target)) close(false); };
  function openMenu(focusFirst) {
    if (open) return;
    open = true;
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onDocPointer, true);
    if (focusFirst) focusItem(0);
  }
  function close(restoreFocus) {
    if (!open) return;
    open = false;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDocPointer, true);
    if (restoreFocus) btn.focus();
  }

  btn.addEventListener('click', () => { open ? close(false) : openMenu(false); });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu(true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); openMenu(true); focusItem(itemEls.length - 1); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); close(false); }
  });
  menu.addEventListener('keydown', (e) => {
    const idx = itemEls.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(idx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(idx - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
    else if (e.key === 'End') { e.preventDefault(); focusItem(itemEls.length - 1); }
    else if (e.key === 'Tab') { close(false); }
  });

  return { wrap, trigger: btn, close: () => close(false) };
}
