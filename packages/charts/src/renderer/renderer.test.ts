import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SvgRenderer } from './svg-renderer.js';
import { CanvasRenderer } from './canvas-renderer.js';
import { createRenderer } from './index.js';

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

describe('SvgRenderer', () => {
  it('creates an <svg> node sized to the viewport', () => {
    const r = new SvgRenderer(400, 300);
    expect(r.node.tagName.toLowerCase()).toBe('svg');
    expect(r.node.getAttribute('width')).toBe('400');
    expect(r.node.getAttribute('viewBox')).toBe('0 0 400 300');
  });

  it('appends primitives as child elements', () => {
    const r = new SvgRenderer(100, 100);
    r.path('M0,0L10,10', { color: 'oklch(var(--jects-data-1))', width: 2 });
    r.rect(0, 0, 10, 10, { color: 'oklch(var(--jects-data-2))' });
    r.circle(5, 5, 3, { color: 'oklch(var(--jects-data-3))' });
    r.line(0, 0, 10, 10, { color: 'oklch(var(--jects-border))' });
    r.text('hi', 5, 5, { color: 'oklch(var(--jects-foreground))' });
    expect(r.node.querySelector('path')).toBeTruthy();
    expect(r.node.querySelector('rect')).toBeTruthy();
    expect(r.node.querySelector('circle')).toBeTruthy();
    expect(r.node.querySelector('line')).toBeTruthy();
    expect(r.node.querySelector('text')!.textContent).toBe('hi');
  });

  it('normalizes negative rect dimensions', () => {
    const r = new SvgRenderer(100, 100);
    r.rect(50, 50, -20, -10, { color: 'oklch(var(--jects-data-1))' });
    const rect = r.node.querySelector('rect')!;
    expect(rect.getAttribute('x')).toBe('30');
    expect(rect.getAttribute('y')).toBe('40');
    expect(rect.getAttribute('width')).toBe('20');
    expect(rect.getAttribute('height')).toBe('10');
  });

  it('clear() removes all children', () => {
    const r = new SvgRenderer(100, 100);
    r.rect(0, 0, 10, 10, { color: 'oklch(var(--jects-data-1))' });
    r.clear();
    expect(r.node.childElementCount).toBe(0);
  });

  it('tag() writes data-* attributes on the last primitive', () => {
    const r = new SvgRenderer(100, 100);
    r.circle(5, 5, 3, { color: 'oklch(var(--jects-data-1))' });
    r.tag({ series: 1, point: 2 });
    const c = r.node.querySelector('circle')!;
    expect(c.getAttribute('data-series')).toBe('1');
    expect(c.getAttribute('data-point')).toBe('2');
  });

  it('toSVG() serializes the markup', () => {
    const r = new SvgRenderer(100, 100);
    r.rect(0, 0, 10, 10, { color: 'oklch(var(--jects-data-1))' });
    const svg = r.toSVG();
    expect(svg).toContain('<svg');
    expect(svg).toContain('rect');
  });
});

describe('CanvasRenderer', () => {
  it('creates a <canvas> node and mirrors to SVG', () => {
    const r = new CanvasRenderer(200, 150);
    expect(r.node.tagName.toLowerCase()).toBe('canvas');
    r.rect(0, 0, 10, 10, { color: 'oklch(var(--jects-data-1))' });
    // The shadow SVG mirror records the same primitive so toSVG() works.
    expect(r.toSVG()).toContain('rect');
  });

  it('does not throw when the 2D context is unavailable (jsdom)', () => {
    const r = new CanvasRenderer(100, 100);
    expect(() => {
      r.clear();
      r.path('M0,0L1,1', { color: 'oklch(var(--jects-data-1))' });
      r.circle(1, 1, 1, { color: 'oklch(var(--jects-data-2))' });
      r.line(0, 0, 1, 1, { color: 'oklch(var(--jects-border))' });
      r.text('x', 0, 0, { color: 'oklch(var(--jects-foreground))' });
    }).not.toThrow();
  });
});

describe('createRenderer', () => {
  it('selects the requested backend', () => {
    expect(createRenderer('svg', 10, 10).kind).toBe('svg');
    expect(createRenderer('canvas', 10, 10).kind).toBe('canvas');
  });
});
