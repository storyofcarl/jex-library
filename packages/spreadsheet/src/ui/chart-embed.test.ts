/** jsdom unit test for embedded charts (range→data transform + wired insert). */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rangeToChartData } from './chart-embed.js';
import { Spreadsheet } from './spreadsheet.js';
import type { CellValue } from '../contract.js';

describe('rangeToChartData (pure)', () => {
  it('reads a header row + label column into categories and named series', () => {
    const block: CellValue[][] = [
      ['Month', 'Sales', 'Costs'],
      ['Jan', 10, 4],
      ['Feb', 20, 8],
    ];
    const data = rangeToChartData(block, 'bar');
    expect(data.categories).toEqual(['Jan', 'Feb']);
    expect(data.series.map((s) => s.name)).toEqual(['Sales', 'Costs']);
    expect(data.series[0]?.data).toEqual([10, 20]);
    expect(data.series[1]?.data).toEqual([4, 8]);
  });

  it('falls back to positional categories for an all-numeric block', () => {
    const block: CellValue[][] = [
      [1, 2],
      [3, 4],
    ];
    const data = rangeToChartData(block, 'line');
    expect(data.categories).toEqual([1, 2]);
    expect(data.series.length).toBe(2);
    expect(data.series[0]?.data).toEqual([1, 3]);
  });
});

describe('Spreadsheet — insertChart wiring', () => {
  let host: HTMLElement;
  let ss: Spreadsheet;
  const ref = (row: number, col: number) => ({ sheet: ss.getApi().getActiveSheet().id, row, col });

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    ss = new Spreadsheet(host, {});
    ss.getApi().setValue(ref(0, 0), 'Q1');
    ss.getApi().setValue(ref(0, 1), 10);
    ss.getApi().setValue(ref(1, 0), 'Q2');
    ss.getApi().setValue(ref(1, 1), 20);
  });
  afterEach(() => {
    if (!ss.isDestroyed) ss.destroy();
    host.remove();
  });

  it('mounts a chart from a range as a floating object', () => {
    const chart = ss.insertChart({ top: 0, left: 0, bottom: 1, right: 1 }, { type: 'bar' });
    expect(chart).toBeTruthy();
    expect(ss.getCharts().length).toBe(1);
    // The floating chart host is mounted over the grid and renders a chart figure.
    const chartHost = host.querySelector('.jects-ss__chart');
    expect(chartHost).toBeTruthy();
    expect(chartHost?.querySelector('.jects-chart')).toBeTruthy();
  });

  it('removes an embedded chart cleanly', () => {
    const chart = ss.insertChart({ top: 0, left: 0, bottom: 1, right: 1 });
    ss.removeChart(chart);
    expect(ss.getCharts().length).toBe(0);
    expect(host.querySelector('.jects-ss__chart')).toBeNull();
  });

  it('tears charts down on destroy', () => {
    ss.insertChart({ top: 0, left: 0, bottom: 1, right: 1 });
    ss.destroy();
    expect(host.querySelector('.jects-ss__chart')).toBeNull();
  });
});
