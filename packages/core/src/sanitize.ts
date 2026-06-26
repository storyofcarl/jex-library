/**
 * Shared, dependency-free HTML sanitization for Jects UI.
 *
 * Implements the `@jects/core` half of the HTML / injection security contract
 * (see `docs/SECURITY.md` §1-§2): an `escape()` helper for untrusted plain text
 * and an allow-list `sanitizeHtml()` for explicitly-authored markup.
 *
 * The sanitizer is DOM-based (`<template>` parsing + tree walk), so it runs in
 * browsers and jsdom. Parsing into an inert `<template>` means no scripts run,
 * no images load, and no event handlers fire while we inspect the tree.
 */

/**
 * HTML-escape untrusted plain text: `&`, `<`, `>`, `"`, `'`.
 *
 * Use this for any caller-supplied string (`text`, `label`, `title`, ...) that
 * gets interpolated into markup. The `&` replacement runs first so already-safe
 * entities are not double-escaped beyond a single pass.
 */
export function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Alias of {@link escape} for callers that prefer the explicit name. */
export const escapeHtml = escape;

/** Options for {@link sanitizeHtml}. */
export interface SanitizeOptions {
  /**
   * Override the allow-listed tag set (lowercase tag names). When omitted the
   * built-in safe formatting set is used. Tags in the hard strip-list
   * (`script`, `style`, `iframe`, ...) are always removed regardless.
   */
  allowedTags?: readonly string[];
  /**
   * Override the per-tag allowed attribute lists. Keys are lowercase tag names;
   * the special key `*` lists attributes allowed on every element. Merged over
   * the built-in defaults (a provided key replaces that tag's default list).
   */
  allowedAttributes?: Readonly<Record<string, readonly string[]>>;
}

/** Tags whose element AND contents are always discarded. */
const STRIP_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
]);

/** Default allow-listed formatting tags (the rich-text output set). */
const DEFAULT_TAGS: ReadonlySet<string> = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'div', 'span', 'br', 'hr',
  'a',
  'b', 'i', 'u', 's', 'strong', 'em', 'mark', 'small', 'sub', 'sup', 'del', 'ins',
  'ul', 'ol', 'li',
  'blockquote', 'code', 'pre', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
  'img',
]);

/** Attributes allowed on every element. */
const GLOBAL_ATTRS: ReadonlySet<string> = new Set([
  'class', 'id', 'title', 'dir', 'lang', 'align', 'style',
]);

/** Per-tag allowed attributes (beyond the global set). */
const DEFAULT_TAG_ATTRS: Readonly<Record<string, readonly string[]>> = {
  a: ['href', 'target', 'rel', 'name'],
  img: ['src', 'alt', 'width', 'height'],
  td: ['colspan', 'rowspan', 'headers', 'scope'],
  th: ['colspan', 'rowspan', 'headers', 'scope', 'abbr'],
  col: ['span'],
  colgroup: ['span'],
  ol: ['start', 'type', 'reversed'],
};

/** URL-bearing attributes whose values must pass the scheme allow-list. */
const URL_ATTRS: ReadonlySet<string> = new Set(['href', 'src', 'xlink:href']);

/** Safe URL schemes for non-`data:` links. */
const SAFE_SCHEMES: ReadonlySet<string> = new Set([
  'http', 'https', 'mailto', 'tel', 'ftp', 'sms',
]);

/** Safe `data:image/*` subtypes (SVG excluded - it can carry script). */
const SAFE_DATA_IMAGE =
  /^data:image\/(png|jpe?g|gif|webp|bmp|avif|x-icon|vnd\.microsoft\.icon)(;|,)/;

/** Control chars and ASCII whitespace browsers strip when resolving a scheme. */
const URL_NOISE = new RegExp('[\u0000-\u0020\u007f-\u00a0]+', 'g')

/**
 * Decide whether a URL attribute value is safe.
 * Returns the original (untouched) value when safe, or `null` to drop it.
 */
function sanitizeUrl(raw: string): string | null {
  // Strip control chars / whitespace browsers ignore when resolving the scheme
  // (e.g. `java\tscript:` -> `javascript:`), then test the scheme only.
  const stripped = raw.replace(URL_NOISE, '').toLowerCase();
  const match = /^([a-z][a-z0-9+.-]*):/.exec(stripped);
  if (!match) return raw; // no scheme -> relative / anchor / fragment, safe
  const scheme = match[1] ?? '';
  if (scheme === 'data') return SAFE_DATA_IMAGE.test(stripped) ? raw : null;
  return SAFE_SCHEMES.has(scheme) ? raw : null;
}

/**
 * Remove executable / navigating constructs from an inline `style` value,
 * dropping any declaration containing `expression(`, `javascript:`,
 * `vbscript:`, or a `url()` pointing at one of those (or `data:text/html`).
 */
function sanitizeStyle(style: string): string {
  const out: string[] = [];
  for (const decl of style.split(';')) {
    const trimmed = decl.trim();
    if (!trimmed) continue;
    const collapsed = trimmed.replace(/\s+/g, '').toLowerCase();
    if (collapsed.includes('expression(')) continue;
    if (/(javascript|vbscript):/.test(collapsed)) continue;
    if (/url\(["']?(javascript|vbscript|data:text\/html)/.test(collapsed)) continue;
    out.push(trimmed);
  }
  return out.join('; ');
}

interface ResolvedConfig {
  tags: ReadonlySet<string>;
  globalAttrs: ReadonlySet<string>;
  tagAttrs: Readonly<Record<string, ReadonlySet<string>>>;
}

function resolveConfig(opts: SanitizeOptions | undefined): ResolvedConfig {
  const tags = opts?.allowedTags ? new Set(opts.allowedTags) : DEFAULT_TAGS;

  let globalAttrs = GLOBAL_ATTRS;
  const tagAttrs: Record<string, ReadonlySet<string>> = {};
  for (const [tag, attrs] of Object.entries(DEFAULT_TAG_ATTRS)) {
    tagAttrs[tag] = new Set(attrs);
  }
  if (opts?.allowedAttributes) {
    for (const [tag, attrs] of Object.entries(opts.allowedAttributes)) {
      if (tag === '*') globalAttrs = new Set(attrs);
      else tagAttrs[tag] = new Set(attrs);
    }
  }
  return { tags, globalAttrs, tagAttrs };
}

function isAttrAllowed(tag: string, attr: string, cfg: ResolvedConfig): boolean {
  if (cfg.globalAttrs.has(attr)) return true;
  // `data-*` and `aria-*` are non-executable, author-controlled hook/a11y
  // attributes; allow them on any element (no script vector). `on*` handlers are
  // already rejected before this is reached (see cleanElement).
  if (attr.startsWith('data-') || attr.startsWith('aria-')) return true;
  return cfg.tagAttrs[tag]?.has(attr) ?? false;
}

/** Build a sanitized element of `tag`, copying only safe attributes from `src`. */
function cleanElement(src: Element, tag: string, cfg: ResolvedConfig): HTMLElement {
  const el = document.createElement(tag);
  for (const attr of Array.from(src.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith('on')) continue; // event handler
    if (!isAttrAllowed(tag, name, cfg)) continue;

    if (URL_ATTRS.has(name)) {
      const safe = sanitizeUrl(attr.value);
      if (safe === null) continue;
      el.setAttribute(name, safe);
    } else if (name === 'style') {
      const safe = sanitizeStyle(attr.value);
      if (safe) el.setAttribute('style', safe);
    } else {
      el.setAttribute(name, attr.value);
    }
  }
  return el;
}

/** Recursively sanitize `source`'s children into `dest`. */
function walk(source: Node, dest: Node, cfg: ResolvedConfig): void {
  for (const node of Array.from(source.childNodes)) {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      dest.appendChild(document.createTextNode(node.nodeValue ?? ''));
      continue;
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) continue; // drop comments, etc.

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (STRIP_TAGS.has(tag)) continue; // remove element and its contents

    if (cfg.tags.has(tag)) {
      const clean = cleanElement(el, tag, cfg);
      walk(el, clean, cfg);
      dest.appendChild(clean);
    } else {
      // Unknown but non-dangerous tag: drop the wrapper, keep its content.
      walk(el, dest, cfg);
    }
  }
}

/**
 * Allow-list HTML sanitizer.
 *
 * Strips dangerous elements (`script`/`style`/`iframe`/`object`/`embed`/`link`/
 * `meta`/`base`/`form`) and all `on*` handler attributes, neutralizes
 * `javascript:`/`vbscript:`/unsafe `data:` URLs in `href`/`src`/`xlink:href`/
 * `style`, removes CSS `expression()` / `url(javascript:)`, and keeps only an
 * allow-listed set of safe formatting tags and attributes. Idempotent: feeding
 * already-sanitized output back in produces the same string.
 */
export function sanitizeHtml(html: string, opts?: SanitizeOptions): string {
  const cfg = resolveConfig(opts);
  const template = document.createElement('template');
  // jects-safe-html: sanitizer's own inert <template> parse (no DOM is live here)
  template.innerHTML = html;
  const out = document.createElement('div');
  walk(template.content, out, cfg);
  return out.innerHTML;
}

/**
 * A string that has been proven safe to assign to `innerHTML` — either because it
 * was run through {@link sanitizeHtml} (see {@link safeHtml}) or because it is a
 * trusted, value-free internal template (see {@link staticHtml}).
 *
 * The `__jectsSafeHtml` brand is a phantom field: it exists only in the type
 * system, so a plain `string` cannot be passed where a `SafeHtml` is expected
 * without going through one of the helpers. This is purely additive — existing
 * `createEl`/`html` options keep accepting `string`; the brand is opt-in for new
 * code, with CI enforcement provided by `scripts/check-html-safety.mjs`.
 */
export type SafeHtml = string & { readonly __jectsSafeHtml: unique symbol };

/**
 * Sanitize `input` through {@link sanitizeHtml}, then brand the result as
 * {@link SafeHtml}. Use for any HTML derived from user/config/data values that
 * still needs to be assigned to `innerHTML`.
 */
export function safeHtml(input: string): SafeHtml {
  return sanitizeHtml(input) as SafeHtml;
}

/**
 * Tagged-template helper for trusted, value-free internal markup. The `values`
 * parameter is typed `never[]`, so the template literal must contain **no**
 * interpolations — any `${...}` is a compile error. This guarantees the produced
 * {@link SafeHtml} carries no caller/user-supplied data.
 *
 * @example
 *   el.innerHTML = staticHtml`<span class="icon" aria-hidden="true"></span>`;
 */
export function staticHtml(strings: TemplateStringsArray, ...values: never[]): SafeHtml {
  void values;
  return strings.join('') as SafeHtml;
}
