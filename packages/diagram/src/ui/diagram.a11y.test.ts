import { describe, it, afterEach, expect } from 'vitest';
import { Diagram } from './diagram.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { ShapeModel } from '../contract.js';

function shape(id: string, x = 0, y = 0): ShapeModel {
  return { id, type: 'process', x, y, w: 120, h: 64, text: id };
}

describe('Diagram a11y', () => {
  let host: HTMLElement;

  afterEach(() => {
    host?.remove();
  });

  it('editable diagram has no serious/critical violations', async () => {
    host = document.createElement('div');
    host.style.width = '900px';
    host.style.height = '600px';
    document.body.appendChild(host);

    const d = new Diagram(host, {
      shapes: [shape('a', 40, 40), shape('b', 300, 200)],
      connectors: [
        { id: 'c', from: { shape: 'a' }, to: { shape: 'b' }, kind: 'orthogonal' },
      ],
    });
    d.select('a');
    d.paint();

    await expectNoA11yViolations(host);
    d.destroy();
  });

  it('canvas is keyboard-operable: role=group with focusable, named shapes', async () => {
    host = document.createElement('div');
    host.style.width = '900px';
    host.style.height = '600px';
    document.body.appendChild(host);

    const d = new Diagram(host, {
      shapes: [shape('a', 40, 40), shape('b', 300, 200)],
    });
    d.paint();

    const canvas = host.querySelector('.jects-diagram__canvas')!;
    // Not role=application (which would suppress browse mode / trap AT users).
    expect(canvas.getAttribute('role')).toBe('group');

    const svg = host.querySelector('svg.jects-diagram__svg')!;
    // Every shape is a named, button-role element; exactly one is in the tab
    // order (roving tabindex), the rest are -1.
    const shapes = [...svg.querySelectorAll('g[data-shape]')];
    expect(shapes.length).toBe(2);
    for (const s of shapes) {
      expect(s.getAttribute('role')).toBe('button');
      expect((s.getAttribute('aria-label') ?? '').length).toBeGreaterThan(0);
    }
    const tabbable = shapes.filter((s) => s.getAttribute('tabindex') === '0');
    expect(tabbable.length).toBe(1);

    await expectNoA11yViolations(host);
    d.destroy();
  });

  it('read-only diagram has no serious/critical violations', async () => {
    host = document.createElement('div');
    host.style.width = '900px';
    host.style.height = '600px';
    document.body.appendChild(host);

    const d = new Diagram(host, {
      editable: false,
      shapes: [shape('a', 40, 40), shape('b', 300, 200)],
    });
    d.paint();

    await expectNoA11yViolations(host);
    d.destroy();
  });
});
