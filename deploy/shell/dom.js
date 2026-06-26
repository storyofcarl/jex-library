/**
 * Tiny DOM helpers shared across the shell + every route module.
 * Extracted verbatim from the original monolithic gallery.js.
 */

/** Build an element with attrs (class/html/text are special) + children. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** A labelled demo card. `mount(host)` receives the body host element. */
export function card(label, mount, { wide = false, block = false } = {}) {
  const bd = el('div', { class: 'g-card__bd' + (block ? ' is-block' : '') });
  const c = el('div', { class: 'g-card' + (wide ? ' is-wide' : '') }, [
    el('div', { class: 'g-card__hd', text: label }),
    bd,
  ]);
  try {
    mount(bd);
  } catch (err) {
    bd.appendChild(el('div', { class: 'g-note', text: 'demo error: ' + err.message }));
    console.error('[gallery] demo "' + label + '" failed:', err);
  }
  return c;
}
