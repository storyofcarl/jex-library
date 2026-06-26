/**
 * Chart stories — framework-free usage examples covering every chart type,
 * plus combination, dual axes, stacking, and both renderers. Each story returns
 * a host-mounting function (the docs app calls `render(host)`).
 */
import { Chart } from './chart.js';
import type { ChartConfig } from './types.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Chart;
}

const story = (name: string, config: ChartConfig): Story => ({
  name,
  render: (host) => new Chart(host, { width: 520, height: 320, ...config }),
});

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

export const stories: Story[] = [
  story('Line', {
    type: 'line',
    categories: months,
    series: [
      { name: 'Revenue', data: [12, 19, 15, 22, 18, 25] },
      { name: 'Cost', data: [8, 11, 9, 13, 12, 15] },
    ],
  }),
  story('Spline', {
    type: 'spline',
    categories: months,
    series: [{ name: 'Sessions', data: [30, 45, 38, 60, 52, 70] }],
  }),
  story('Bar', {
    type: 'bar',
    categories: months,
    series: [
      { name: 'A', data: [5, 8, 6, 9, 7, 10] },
      { name: 'B', data: [3, 5, 4, 6, 5, 7] },
    ],
  }),
  story('Stacked bar', {
    type: 'bar',
    categories: months,
    stacked: true,
    series: [
      { name: 'Online', data: [5, 8, 6, 9, 7, 10] },
      { name: 'Retail', data: [3, 5, 4, 6, 5, 7] },
    ],
  }),
  story('Horizontal bar', {
    type: 'horizontalBar',
    categories: ['North', 'South', 'East', 'West'],
    series: [{ name: 'Units', data: [40, 25, 33, 18] }],
  }),
  story('Area', {
    type: 'area',
    categories: months,
    series: [{ name: 'Traffic', data: [10, 22, 18, 30, 26, 35] }],
  }),
  story('Spline area', {
    type: 'splineArea',
    categories: months,
    series: [{ name: 'Load', data: [10, 22, 18, 30, 26, 35] }],
  }),
  story('Pie', {
    type: 'pie',
    categories: ['Cyan', 'Magenta', 'Yellow', 'Key'],
    data: [30, 25, 20, 25],
  }),
  story('Donut', {
    type: 'donut',
    categories: ['Cyan', 'Magenta', 'Yellow', 'Key'],
    data: [30, 25, 20, 25],
    innerRadius: 0.62,
  }),
  story('Radar', {
    type: 'radar',
    categories: ['Speed', 'Power', 'Range', 'Agility', 'Defense'],
    series: [
      { name: 'Alpha', data: [80, 65, 70, 90, 60] },
      { name: 'Beta', data: [60, 80, 85, 55, 75] },
    ],
  }),
  story('Scatter', {
    type: 'scatter',
    categories: months,
    series: [{ name: 'Points', data: [12, 5, 18, 9, 22, 14] }],
  }),
  story('Treemap', {
    type: 'treemap',
    categories: ['Search', 'Social', 'Direct', 'Email', 'Referral'],
    data: [50, 30, 20, 12, 8],
  }),
  story('Heatmap', {
    type: 'heatmap',
    categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    series: [
      { name: 'wk1', data: [], matrix: [
        [1, 3, 2, 5, 4],
        [2, 4, 6, 3, 1],
        [5, 2, 3, 4, 6],
      ] },
    ],
  }),
  story('Combination (bar + line)', {
    categories: months,
    series: [
      { name: 'Volume', data: [5, 8, 6, 9, 7, 10], type: 'bar' },
      { name: 'Trend', data: [4, 6, 5, 8, 6, 9], type: 'line' },
    ],
  }),
  story('Dual axes', {
    type: 'line',
    categories: months,
    yAxis: [{ title: 'Revenue' }, { title: 'Rate' }],
    series: [
      { name: 'Revenue', data: [120, 190, 150, 220, 180, 250], axis: 'left' },
      { name: 'Conversion %', data: [2.1, 3.4, 2.8, 4.0, 3.2, 4.6], axis: 'right' },
    ],
  }),
  story('Canvas renderer', {
    type: 'bar',
    renderer: 'canvas',
    categories: months,
    series: [{ name: 'Canvas', data: [5, 8, 6, 9, 7, 10] }],
  }),
];
