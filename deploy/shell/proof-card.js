/**
 * Reusable PROOF PANEL — a tidy titled key/value panel used to summarize a
 * module's hard capabilities directly above its live demo. Token-only chrome,
 * consistent with the rest of the gallery shell.
 *
 *   proofPanel({ title, items }) → HTMLElement
 *     title — the panel heading (e.g. 'Grid — at a glance')
 *     items — Array<[label, value]> key/value pairs
 *
 * Returns a detached element; the caller appends it where it wants (typically
 * the first child of a route's section grid, above the demo cards).
 */

import { el } from './dom.js';

export function proofPanel({ title, items = [] } = {}) {
  const dl = el('dl', { class: 'g-proof__list' });
  for (const [label, value] of items) {
    if (label == null) continue;
    dl.appendChild(el('div', { class: 'g-proof__row' }, [
      el('dt', { class: 'g-proof__k', text: String(label) }),
      el('dd', { class: 'g-proof__v', text: value == null ? '' : String(value) }),
    ]));
  }
  return el('div', { class: 'g-proof' }, [
    title ? el('div', { class: 'g-proof__hd', text: title }) : null,
    dl,
  ]);
}
