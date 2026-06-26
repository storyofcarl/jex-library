/**
 * Accessibility (axe-core) test for the Scheduler — real Chromium via
 * `vitest --config vitest.browser.config.ts`. Asserts zero serious/critical
 * violations (Quality Gate Q2). Also exercises the PRO views' a11y.
 */
import { describe, it, afterEach, expect } from 'vitest';
import { HOUR_AND_DAY } from '@jects/timeline-core';
import '@jects/theme/style.css';
import '../styles.css';
import { Scheduler } from './scheduler.js';
import { HistogramView, UtilizationView } from '../pro/histogram-view.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const DAY = 86_400_000;
const start = Date.UTC(2025, 0, 1);

let host: HTMLElement;
const widgets: Array<{ destroy(): void }> = [];

afterEach(() => {
  for (const w of widgets.splice(0)) w.destroy();
  host?.remove();
});

function mount(): HTMLElement {
  host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '400px';
  document.body.appendChild(host);
  return host;
}

describe('Scheduler a11y', () => {
  it('has no serious/critical violations', async () => {
    const h = mount();
    const s = new Scheduler(h, {
      resources: [
        { id: 'r1', name: 'Alice' },
        { id: 'r2', name: 'Bob' },
      ],
      events: [
        { id: 'e1', resourceId: 'r1', name: 'Task A', startDate: start, endDate: start + DAY },
        { id: 'e2', resourceId: 'r2', name: 'Task B', startDate: start + DAY, endDate: start + DAY * 2 },
      ],
      preset: HOUR_AND_DAY,
      range: { start: start - DAY, end: start + DAY * 5 },
    });
    widgets.push(s);
    await expectNoA11yViolations(h);
    // The root is keyboard-focusable and labelled.
    expect(s.el.getAttribute('aria-label')).toBeTruthy();
    expect(s.el.tabIndex).toBe(0);
  });

  it('PRO histogram + utilization views are accessible', async () => {
    const h = mount();
    const resources = [
      { id: 'r1', name: 'Alice', capacity: 1 },
      { id: 'r2', name: 'Bob', capacity: 2 },
    ];
    const events = [
      { id: 'e1', resourceId: 'r1', name: 'A', startDate: start, endDate: start + DAY },
    ];
    const range = { start, end: start + DAY * 3 };
    const hv = new HistogramView(h, { resources, events, range, title: 'Allocation' });
    const uv = new UtilizationView(h, { resources, events, range, title: 'Utilization' });
    widgets.push(hv, uv);
    await expectNoA11yViolations(h);
  });

  it('histogram conveys over-capacity without relying on color', async () => {
    const h = mount();
    // r1 capacity 1, but two overlapping events on r1 in the same bucket → over.
    const resources = [{ id: 'r1', name: 'Alice', capacity: 1 }];
    const events = [
      { id: 'e1', resourceId: 'r1', name: 'A', startDate: start, endDate: start + DAY },
      { id: 'e2', resourceId: 'r1', name: 'B', startDate: start, endDate: start + DAY },
    ];
    const range = { start, end: start + DAY };
    const hv = new HistogramView(h, { resources, events, range, slotMs: DAY, title: 'Allocation' });
    widgets.push(hv);
    await expectNoA11yViolations(h);

    // The root summary names the over-capacity resource (text, not color)…
    expect(hv.el.getAttribute('aria-label')).toContain('Over capacity');
    expect(hv.el.getAttribute('aria-label')).toContain('Alice');
    // …and the over-capacity bucket carries an explicit textual indicator + glyph.
    const overBar = hv.el.querySelector('.jects-resource-histogram__bar--over') as HTMLElement;
    expect(overBar).toBeTruthy();
    expect(overBar.getAttribute('aria-label')).toContain('over capacity');
    expect(overBar.querySelector('.jects-resource-histogram__over-flag')).toBeTruthy();
  });
});
