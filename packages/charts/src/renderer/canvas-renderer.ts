import type { Renderer, StrokeStyle, FillStyle, TextStyle } from './renderer.js';
import { SvgRenderer } from './svg-renderer.js';

/**
 * Canvas backend — draws to a bitmap. For `toSVG()` we keep a shadow SVG
 * renderer recording the same primitives, so both export paths work and the two
 * backends stay structurally identical (useful for tests & SSR-less export).
 */
export class CanvasRenderer implements Renderer {
  readonly kind = 'canvas' as const;
  readonly node: HTMLCanvasElement;
  width: number;
  height: number;
  private ctx: CanvasRenderingContext2D | null;
  private dpr: number;
  /** Shadow SVG mirror, recording the same calls for toSVG(). */
  private mirror: SvgRenderer;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.node = document.createElement('canvas');
    this.node.className = 'jects-chart__canvas';
    // The graphic surface must present as a labeled image to assistive tech.
    this.node.setAttribute('role', 'img');
    this.dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    this.ctx = this.node.getContext('2d');
    this.mirror = new SvgRenderer(width, height);
    this.applySize();
  }

  private applySize(): void {
    this.node.width = Math.round(this.width * this.dpr);
    this.node.height = Math.round(this.height * this.dpr);
    this.node.style.width = `${this.width}px`;
    this.node.style.height = `${this.height}px`;
    if (this.ctx) {
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.applySize();
    this.mirror.resize(width, height);
  }

  describe(label: string, desc?: string): void {
    // Canvas has no DOM children for AT, so the accessible name lives on the
    // element itself; fallback text (read by AT that can't render the bitmap)
    // is the element's text content.
    if (label) this.node.setAttribute('aria-label', label);
    else this.node.removeAttribute('aria-label');
    this.node.textContent = [label, desc].filter(Boolean).join('. ');
    // Keep the SVG mirror's accessible structure in sync for toSVG() export.
    this.mirror.describe(label, desc);
  }

  clear(): void {
    if (this.ctx) this.ctx.clearRect(0, 0, this.width, this.height);
    this.mirror.clear();
  }

  /** Resolve a fill to a concrete canvas paint (flat color or a linear gradient). */
  private fillStyleFor(fill: FillStyle): string | CanvasGradient {
    const g = fill.gradient;
    if (g && this.ctx) {
      const grad = this.ctx.createLinearGradient(g.x1, g.y1, g.x2, g.y2);
      for (const s of g.stops) {
        const offset = Math.min(1, Math.max(0, s.offset));
        grad.addColorStop(offset, s.color);
      }
      return grad;
    }
    return fill.color;
  }

  path(d: string, stroke?: StrokeStyle, fill?: FillStyle): void {
    this.mirror.path(d, stroke, fill);
    const ctx = this.ctx;
    if (!ctx) return;
    const p = new Path2D(d);
    if (fill) {
      ctx.save();
      ctx.globalAlpha = fill.opacity ?? 1;
      ctx.fillStyle = this.fillStyleFor(fill);
      ctx.fill(p);
      ctx.restore();
    }
    if (stroke) {
      ctx.save();
      ctx.globalAlpha = stroke.opacity ?? 1;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width ?? 1;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (stroke.dash) ctx.setLineDash(stroke.dash);
      ctx.stroke(p);
      ctx.restore();
    }
  }

  rect(x: number, y: number, w: number, h: number, fill?: FillStyle, stroke?: StrokeStyle): void {
    this.mirror.rect(x, y, w, h, fill, stroke);
    const ctx = this.ctx;
    if (!ctx) return;
    const nx = w < 0 ? x + w : x;
    const ny = h < 0 ? y + h : y;
    const nw = Math.abs(w);
    const nh = Math.abs(h);
    if (fill) {
      ctx.save();
      ctx.globalAlpha = fill.opacity ?? 1;
      ctx.fillStyle = this.fillStyleFor(fill);
      ctx.fillRect(nx, ny, nw, nh);
      ctx.restore();
    }
    if (stroke) {
      ctx.save();
      ctx.globalAlpha = stroke.opacity ?? 1;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width ?? 1;
      ctx.strokeRect(nx, ny, nw, nh);
      ctx.restore();
    }
  }

  line(x1: number, y1: number, x2: number, y2: number, stroke: StrokeStyle): void {
    this.mirror.line(x1, y1, x2, y2, stroke);
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.save();
    ctx.globalAlpha = stroke.opacity ?? 1;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width ?? 1;
    if (stroke.dash) ctx.setLineDash(stroke.dash);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  circle(cx: number, cy: number, r: number, fill?: FillStyle, stroke?: StrokeStyle): void {
    this.mirror.circle(cx, cy, r, fill, stroke);
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    if (fill) {
      ctx.save();
      ctx.globalAlpha = fill.opacity ?? 1;
      ctx.fillStyle = this.fillStyleFor(fill);
      ctx.fill();
      ctx.restore();
    }
    if (stroke) {
      ctx.save();
      ctx.globalAlpha = stroke.opacity ?? 1;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width ?? 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  text(s: string, x: number, y: number, style: TextStyle): void {
    this.mirror.text(s, x, y, style);
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.save();
    ctx.fillStyle = style.color;
    const size = style.size ?? 12;
    const family = style.family ?? 'sans-serif';
    const weight = style.weight ?? 'normal';
    ctx.font = `${weight} ${size}px ${family}`;
    ctx.textAlign = style.align === 'middle' ? 'center' : (style.align ?? 'start') as CanvasTextAlign;
    ctx.textBaseline = mapBaseline(style.baseline);
    ctx.fillText(s, x, y);
    ctx.restore();
  }

  tag(meta: Record<string, string | number>): void {
    // Mirror keeps tags for SVG export; canvas hit-testing is done in math space.
    this.mirror.tag(meta);
  }

  toSVG(): string {
    return this.mirror.toSVG();
  }

  async toPNG(): Promise<string> {
    // Direct bitmap export — already rasterized.
    return this.node.toDataURL('image/png');
  }
}

function mapBaseline(b?: TextStyle['baseline']): CanvasTextBaseline {
  switch (b) {
    case 'top':
      return 'top';
    case 'middle':
      return 'middle';
    case 'bottom':
      return 'bottom';
    default:
      return 'alphabetic';
  }
}
