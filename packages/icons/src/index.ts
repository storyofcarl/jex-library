/**
 * @jects/icons — tree-shakeable inline SVG icons.
 *
 * Usage:
 *   import { renderIcon } from '@jects/icons';
 *   el.innerHTML = renderIcon('search', { size: 16 });
 * Or build a sprite reference: `<svg><use href="#jects-i-search"/></svg>`.
 */

import { icons, iconNames, type IconName, type IconDef } from './icons.js';

export { icons, iconNames, type IconName, type IconDef };

/**
 * Branded trusted HTML — local mirror of `@jects/core`'s `SafeHtml` discipline.
 *
 * `@jects/icons` is a zero-dependency leaf package (it must not depend on
 * `@jects/core`, which would invert the suite's layering and risk a cycle, since
 * higher packages depend on both). So the SafeHtml branding is defined inline
 * here. The brand is structurally identical to `@jects/core`'s, so the values
 * interoperate at runtime; only the compile-time guard is local.
 */
type SafeHtml = string & { readonly __jectsSafeHtml: unique symbol };

/**
 * Brand a string of trusted, library-controlled markup as {@link SafeHtml}
 * WITHOUT sanitizing it. Icon output is fixed SVG produced by {@link renderIcon}
 * (the only dynamic parts are numeric sizes and an attribute-escaped label), so
 * it must never be routed through an HTML sanitizer — that would strip the SVG.
 */
function trustedHtml(input: string): SafeHtml {
  return input as SafeHtml;
}

/**
 * The only sanctioned `innerHTML` sink in this package — the local mirror of
 * `@jects/core`'s `setHtml`. Defined here (rather than imported) to keep
 * `@jects/icons` a zero-dependency leaf; `html` is branded {@link SafeHtml}, so
 * this is the single place a raw assignment is permitted (cf. core/sanitize.ts).
 */
function setHtml(el: Element, html: SafeHtml): void {
  // eslint-disable-next-line no-restricted-syntax -- sanctioned SafeHtml sink (local mirror of @jects/core setHtml)
  el.innerHTML = html;
}

export interface RenderIconOptions {
  /** Rendered pixel size (width=height). Default 24. */
  size?: number;
  /** Stroke width. Default 2. */
  strokeWidth?: number;
  /** Extra class names. The base class `jects-icon` is always applied. */
  className?: string;
  /** Accessible label; when omitted the icon is marked aria-hidden. */
  label?: string;
}

/** Render an icon to an inline SVG string (stroke uses `currentColor`). */
export function renderIcon(name: IconName, options: RenderIconOptions = {}): string {
  const def: IconDef = icons[name];
  const size = options.size ?? 24;
  const strokeWidth = options.strokeWidth ?? 2;
  const cls = ['jects-icon', options.className].filter(Boolean).join(' ');
  const a11y = options.label
    ? `role="img" aria-label="${escapeAttr(options.label)}"`
    : 'aria-hidden="true"';
  return (
    `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 ${def.size} ${def.size}" ` +
    `fill="none" stroke="currentColor" stroke-width="${strokeWidth}" ` +
    `stroke-linecap="round" stroke-linejoin="round" ${a11y}>${def.body}</svg>`
  );
}

/** Render an icon to a detached SVGElement (DOM contexts). */
export function createIconEl(name: IconName, options: RenderIconOptions = {}): SVGElement {
  const tpl = document.createElement('template');
  setHtml(tpl, trustedHtml(renderIcon(name, options).trim()));
  return tpl.content.firstChild as SVGElement;
}

/** The `<symbol>` id used in the sprite for an icon. */
export function spriteId(name: IconName): string {
  return `jects-i-${name}`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
