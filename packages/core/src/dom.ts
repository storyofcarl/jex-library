/**
 * Framework-free DOM utilities: element creation, class helpers, delegated event
 * binding, text measurement, scrollbar width, focus trap, and RTL detection.
 */

export type ClassValue = string | false | null | undefined | Record<string, boolean> | ClassValue[];

/** Combine class values (string | array | {name:bool}) into a single className string. */
export function classNames(...values: ClassValue[]): string {
  const out: string[] = [];
  const walk = (v: ClassValue): void => {
    if (!v) return;
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object') {
      for (const [k, on] of Object.entries(v)) if (on) out.push(k);
    }
  };
  values.forEach(walk);
  return out.join(' ');
}

export interface CreateElOptions {
  className?: ClassValue;
  /** Plain text content (escaped by the DOM). */
  text?: string;
  /** Trusted HTML — only pass library-controlled markup. */
  html?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  dataset?: Record<string, string | number | boolean>;
  style?: Partial<CSSStyleDeclaration> | Record<string, string>;
  children?: Array<Node | string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
}

/** Create an element with className, attrs, dataset, style, children and listeners. */
export function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: CreateElOptions = {},
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (options.className) el.className = classNames(options.className);
  if (options.text !== undefined) el.textContent = options.text;
  if (options.html !== undefined) el.innerHTML = options.html;
  if (options.attrs) {
    for (const [k, v] of Object.entries(options.attrs)) {
      if (v === null || v === undefined || v === false) continue;
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  if (options.dataset) {
    for (const [k, v] of Object.entries(options.dataset)) el.dataset[k] = String(v);
  }
  if (options.style) Object.assign(el.style, options.style);
  if (options.children) {
    for (const c of options.children) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  if (options.on) {
    for (const [evt, fn] of Object.entries(options.on)) {
      if (fn) el.addEventListener(evt, fn as EventListener);
    }
  }
  return el;
}

/** Add/remove/toggle a class. */
export function setClass(el: Element, name: string, on: boolean): void {
  el.classList.toggle(name, on);
}

/** Resolve a host argument that may be an element or a CSS selector. */
export function resolveHost(host: HTMLElement | string): HTMLElement {
  if (typeof host === 'string') {
    const found = document.querySelector(host);
    if (!found) throw new Error(`Jects: host selector "${host}" matched no element.`);
    return found as HTMLElement;
  }
  return host;
}

/** A bound delegated listener; call to detach. */
export type Unbind = () => void;

/**
 * Delegated event binding: listen on `root` for `evt`, invoking `fn` only when the
 * event target matches `selector` (or an ancestor up to `root` does). `this`/the
 * second arg is the matched element.
 */
export function on<E extends keyof HTMLElementEventMap>(
  root: HTMLElement,
  selector: string,
  evt: E,
  fn: (event: HTMLElementEventMap[E], matched: HTMLElement) => void,
): Unbind {
  const listener = (event: Event): void => {
    const target = event.target as Element | null;
    if (!target) return;
    const matched = target.closest(selector);
    if (matched && root.contains(matched)) {
      fn(event as HTMLElementEventMap[E], matched as HTMLElement);
    }
  };
  root.addEventListener(evt, listener);
  return () => root.removeEventListener(evt, listener);
}

let measureCanvas: HTMLCanvasElement | null = null;

/** Measure rendered text width (px) for a given CSS font shorthand. Canvas-based, layout-free. */
export function measureText(text: string, font: string): number {
  measureCanvas ??= document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return 0;
  ctx.font = font;
  return ctx.measureText(text).width;
}

let scrollbarWidth: number | null = null;

/** Width (px) of the native vertical scrollbar; measured once and cached. */
export function getScrollbarWidth(): number {
  if (scrollbarWidth !== null) return scrollbarWidth;
  const outer = document.createElement('div');
  outer.style.cssText = 'visibility:hidden;overflow:scroll;position:absolute;width:100px;height:100px;';
  document.body.appendChild(outer);
  const inner = document.createElement('div');
  outer.appendChild(inner);
  scrollbarWidth = outer.offsetWidth - inner.offsetWidth;
  outer.remove();
  return scrollbarWidth;
}

const FOCUSABLE =
  'a[href],area[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** All tabbable descendants of `el`, in DOM order. */
export function getFocusable(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (n) => n.offsetParent !== null || n === document.activeElement,
  );
}

/**
 * Trap Tab focus inside `el`. Returns a disposer that releases the trap.
 * Focuses the first focusable element on activation.
 */
export function trapFocus(el: HTMLElement): Unbind {
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    const focusables = getFocusable(el);
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
  el.addEventListener('keydown', onKeydown);
  getFocusable(el)[0]?.focus();
  return () => el.removeEventListener('keydown', onKeydown);
}

/** True if `el` (or the document) resolves to right-to-left direction. */
export function isRTL(el?: HTMLElement): boolean {
  const target = el ?? document.documentElement;
  return getComputedStyle(target).direction === 'rtl';
}
