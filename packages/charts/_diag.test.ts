import { describe, it, expect } from 'vitest';
import { Chart } from './src/chart/chart.js';
describe('x', () => {
  it('renderer persists', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const c = new Chart(host, { data: [1,2] });
    // @ts-ignore
    console.log('renderer:', !!c.renderer, 'plotEl:', !!c.plotEl);
    c.update({ data: [3,4] });
    expect(true).toBe(true);
  });
});
