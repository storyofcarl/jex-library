import type { Renderer, StrokeStyle, FillStyle, TextStyle } from './renderer.js';

const NS = 'http://www.w3.org/2000/svg';

let svgSeq = 0;

/** SVG backend — builds real SVG DOM, themable & directly serializable. */
export class SvgRenderer implements Renderer {
  readonly kind = 'svg' as const;
  readonly node: SVGSVGElement;
  width: number;
  height: number;
  private last: SVGElement | null = null;
  /** Unique suffix for the a11y <title>/<desc> element ids. */
  private readonly uid = `jects-chart-${++svgSeq}`;
  private a11yLabel = '';
  private a11yDesc = '';
  /** Per-frame gradient id counter (reset each clear()). */
  private gradSeq = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.node = document.createElementNS(NS, 'svg') as SVGSVGElement;
    this.node.setAttribute('class', 'jects-chart__svg');
    // The graphic surface must present as a labeled image to assistive tech.
    this.node.setAttribute('role', 'img');
    this.applySize();
  }

  describe(label: string, desc?: string): void {
    this.a11yLabel = label ?? '';
    this.a11yDesc = desc ?? '';
    this.applyA11y();
  }

  /** (Re)insert the <title>/<desc> nodes and wire aria-* references. */
  private applyA11y(): void {
    // Remove any prior a11y nodes (clear() also drops them mid-frame).
    for (const sel of ['title', 'desc']) {
      const existing = this.node.querySelector(`:scope > ${sel}`);
      if (existing) this.node.removeChild(existing);
    }
    const labelledBy: string[] = [];
    const describedBy: string[] = [];

    if (this.a11yLabel) {
      this.node.setAttribute('aria-label', this.a11yLabel);
      const titleId = `${this.uid}-title`;
      const title = document.createElementNS(NS, 'title');
      title.setAttribute('id', titleId);
      title.textContent = this.a11yLabel;
      // Title/desc must be the FIRST children to be announced.
      this.node.insertBefore(title, this.node.firstChild);
      labelledBy.push(titleId);
    } else {
      this.node.removeAttribute('aria-label');
    }

    if (this.a11yDesc) {
      const descId = `${this.uid}-desc`;
      const desc = document.createElementNS(NS, 'desc');
      desc.setAttribute('id', descId);
      desc.textContent = this.a11yDesc;
      // Insert after <title> (or first) so order is title → desc.
      const titleNode = this.node.querySelector(':scope > title');
      this.node.insertBefore(desc, titleNode ? titleNode.nextSibling : this.node.firstChild);
      describedBy.push(descId);
    }

    if (labelledBy.length) this.node.setAttribute('aria-labelledby', labelledBy.join(' '));
    else this.node.removeAttribute('aria-labelledby');
    if (describedBy.length) this.node.setAttribute('aria-describedby', describedBy.join(' '));
    else this.node.removeAttribute('aria-describedby');
  }

  private applySize(): void {
    this.node.setAttribute('width', String(this.width));
    this.node.setAttribute('height', String(this.height));
    this.node.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.applySize();
  }

  clear(): void {
    while (this.node.firstChild) this.node.removeChild(this.node.firstChild);
    this.last = null;
    this.gradSeq = 0;
    // Re-establish the accessible <title>/<desc> for the fresh frame.
    if (this.a11yLabel || this.a11yDesc) this.applyA11y();
  }

  /** Lazily create (or reuse) the per-svg <defs> container for gradients. */
  private ensureDefs(): SVGDefsElement {
    let defs = this.node.querySelector(':scope > defs') as SVGDefsElement | null;
    if (!defs) {
      defs = document.createElementNS(NS, 'defs');
      this.node.appendChild(defs);
    }
    return defs;
  }

  /** Register a <linearGradient> from a fill's gradient spec; returns its id. */
  private addGradient(g: NonNullable<FillStyle['gradient']>): string {
    const defs = this.ensureDefs();
    const id = `${this.uid}-grad-${++this.gradSeq}`;
    const lg = document.createElementNS(NS, 'linearGradient');
    lg.setAttribute('id', id);
    lg.setAttribute('gradientUnits', 'userSpaceOnUse');
    lg.setAttribute('x1', String(g.x1));
    lg.setAttribute('y1', String(g.y1));
    lg.setAttribute('x2', String(g.x2));
    lg.setAttribute('y2', String(g.y2));
    for (const s of g.stops) {
      const stop = document.createElementNS(NS, 'stop');
      stop.setAttribute('offset', String(s.offset));
      stop.setAttribute('stop-color', s.color);
      if (s.opacity !== undefined) stop.setAttribute('stop-opacity', String(s.opacity));
      lg.appendChild(stop);
    }
    defs.appendChild(lg);
    return id;
  }

  private applyStroke(el: SVGElement, stroke?: StrokeStyle): void {
    if (!stroke) {
      el.setAttribute('stroke', 'none');
      return;
    }
    el.setAttribute('stroke', stroke.color);
    el.setAttribute('stroke-width', String(stroke.width ?? 1));
    if (stroke.dash && stroke.dash.length) el.setAttribute('stroke-dasharray', stroke.dash.join(','));
    if (stroke.opacity !== undefined) el.setAttribute('stroke-opacity', String(stroke.opacity));
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('stroke-linecap', 'round');
  }

  private applyFill(el: SVGElement, fill?: FillStyle): void {
    if (!fill) {
      el.setAttribute('fill', 'none');
      return;
    }
    if (fill.gradient) {
      el.setAttribute('fill', `url(#${this.addGradient(fill.gradient)})`);
    } else {
      el.setAttribute('fill', fill.color);
    }
    if (fill.opacity !== undefined) el.setAttribute('fill-opacity', String(fill.opacity));
  }

  path(d: string, stroke?: StrokeStyle, fill?: FillStyle): void {
    const el = document.createElementNS(NS, 'path');
    el.setAttribute('d', d);
    this.applyFill(el, fill);
    this.applyStroke(el, stroke);
    this.node.appendChild(el);
    this.last = el;
  }

  rect(x: number, y: number, w: number, h: number, fill?: FillStyle, stroke?: StrokeStyle): void {
    const el = document.createElementNS(NS, 'rect');
    // Normalize negative width/height.
    el.setAttribute('x', String(w < 0 ? x + w : x));
    el.setAttribute('y', String(h < 0 ? y + h : y));
    el.setAttribute('width', String(Math.abs(w)));
    el.setAttribute('height', String(Math.abs(h)));
    this.applyFill(el, fill);
    this.applyStroke(el, stroke);
    this.node.appendChild(el);
    this.last = el;
  }

  line(x1: number, y1: number, x2: number, y2: number, stroke: StrokeStyle): void {
    const el = document.createElementNS(NS, 'line');
    el.setAttribute('x1', String(x1));
    el.setAttribute('y1', String(y1));
    el.setAttribute('x2', String(x2));
    el.setAttribute('y2', String(y2));
    this.applyStroke(el, stroke);
    this.node.appendChild(el);
    this.last = el;
  }

  circle(cx: number, cy: number, r: number, fill?: FillStyle, stroke?: StrokeStyle): void {
    const el = document.createElementNS(NS, 'circle');
    el.setAttribute('cx', String(cx));
    el.setAttribute('cy', String(cy));
    el.setAttribute('r', String(r));
    this.applyFill(el, fill);
    this.applyStroke(el, stroke);
    this.node.appendChild(el);
    this.last = el;
  }

  text(s: string, x: number, y: number, style: TextStyle): void {
    const el = document.createElementNS(NS, 'text');
    el.setAttribute('x', String(x));
    el.setAttribute('y', String(y));
    el.setAttribute('fill', style.color);
    el.setAttribute('font-size', String(style.size ?? 12));
    if (style.family) el.setAttribute('font-family', style.family);
    if (style.weight !== undefined) el.setAttribute('font-weight', String(style.weight));
    el.setAttribute('text-anchor', style.align ?? 'start');
    el.setAttribute('dominant-baseline', mapBaseline(style.baseline));
    el.textContent = s;
    this.node.appendChild(el);
    this.last = el;
  }

  tag(meta: Record<string, string | number>): void {
    if (!this.last) return;
    for (const [k, v] of Object.entries(meta)) this.last.setAttribute(`data-${k}`, String(v));
  }

  toSVG(): string {
    return new XMLSerializer().serializeToString(this.node);
  }

  async toPNG(): Promise<string> {
    return svgStringToPng(this.toSVG(), this.width, this.height);
  }
}

function mapBaseline(b?: TextStyle['baseline']): string {
  switch (b) {
    case 'top':
      return 'hanging';
    case 'middle':
      return 'middle';
    case 'bottom':
      return 'ideographic';
    default:
      return 'alphabetic';
  }
}

/** Rasterize an SVG string to a PNG data URL via an offscreen canvas. */
export async function svgStringToPng(svg: string, width: number, height: number): Promise<string> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('toPNG() requires a browser environment');
  }
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to rasterize SVG'));
    img.src = src;
  });
}
