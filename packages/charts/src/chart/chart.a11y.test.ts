/**
 * Accessibility (axe-core) suite — Quality Gate Q2. Runs in real Chromium.
 * Asserts zero serious/critical violations for representative chart types.
 * The interactive legend uses real <button>s with aria-pressed; the tooltip is
 * role=tooltip and aria-hidden-toggled.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '../styles.css';
import { Chart } from './chart.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '520px';
  document.body.appendChild(host);
});
afterEach(() => host.remove());

describe('Chart a11y', () => {
  it('line chart has no serious/critical violations', async () => {
    const c = new Chart(host, {
      type: 'line',
      width: 520,
      height: 320,
      categories: ['a', 'b', 'c'],
      series: [{ name: 'Revenue', data: [1, 2, 3] }, { name: 'Cost', data: [3, 2, 1] }],
    });
    await expectNoA11yViolations(host);
    c.destroy();
  });

  it('bar chart legend buttons are accessible', async () => {
    const c = new Chart(host, {
      type: 'bar',
      width: 520,
      height: 320,
      categories: ['a', 'b'],
      legend: { show: true, position: 'bottom' },
      series: [{ name: 'A', data: [1, 2] }, { name: 'B', data: [3, 4] }],
    });
    const item = host.querySelector('.jects-chart__legend-item')!;
    expect(item.getAttribute('aria-pressed')).toBe('true');
    await expectNoA11yViolations(host);
    c.destroy();
  });

  it('pie chart has no serious/critical violations', async () => {
    const c = new Chart(host, {
      type: 'pie',
      width: 400,
      height: 320,
      categories: ['Cyan', 'Magenta', 'Yellow'],
      data: [30, 25, 20],
    });
    await expectNoA11yViolations(host);
    c.destroy();
  });
});
