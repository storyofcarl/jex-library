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
  tpl.innerHTML = renderIcon(name, options).trim();
  return tpl.content.firstChild as SVGElement;
}

/** The `<symbol>` id used in the sprite for an icon. */
export function spriteId(name: IconName): string {
  return `jects-i-${name}`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
