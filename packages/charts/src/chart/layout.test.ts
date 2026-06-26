import { describe, it, expect } from 'vitest';
import { computeLayout, LAYOUT_CONSTANTS } from './layout.js';

const PAD = { top: 10, right: 10, bottom: 10, left: 10 };

describe('computeLayout', () => {
  it('reserves space for left axis and x axis', () => {
    const { plot } = computeLayout({
      width: 400,
      height: 300,
      padding: PAD,
      hasLeftAxis: true,
      hasRightAxis: false,
      hasXAxis: true,
      hasTitle: false,
      legend: 'none',
    });
    expect(plot.x).toBe(PAD.left + LAYOUT_CONSTANTS.AXIS_Y_WIDTH);
    expect(plot.width).toBe(400 - plot.x - PAD.right);
    expect(plot.height).toBe(300 - PAD.top - PAD.bottom - LAYOUT_CONSTANTS.AXIS_X_HEIGHT);
  });

  it('reserves both sides for dual axes', () => {
    const { plot } = computeLayout({
      width: 400,
      height: 300,
      padding: PAD,
      hasLeftAxis: true,
      hasRightAxis: true,
      hasXAxis: false,
      hasTitle: false,
      legend: 'none',
    });
    expect(plot.x).toBe(PAD.left + LAYOUT_CONSTANTS.AXIS_Y_WIDTH);
    expect(400 - plot.x - plot.width).toBe(PAD.right + LAYOUT_CONSTANTS.AXIS_Y_WIDTH);
  });

  it('reserves a band for a bottom legend', () => {
    const { plot, legendRect } = computeLayout({
      width: 400,
      height: 300,
      padding: PAD,
      hasLeftAxis: false,
      hasRightAxis: false,
      hasXAxis: false,
      hasTitle: false,
      legend: 'bottom',
    });
    expect(legendRect).not.toBeNull();
    expect(legendRect!.height).toBe(LAYOUT_CONSTANTS.LEGEND_BAND);
    expect(plot.y + plot.height).toBeLessThanOrEqual(legendRect!.y);
  });

  it('reserves a title band', () => {
    const { plot, titleRect } = computeLayout({
      width: 400,
      height: 300,
      padding: PAD,
      hasLeftAxis: false,
      hasRightAxis: false,
      hasXAxis: false,
      hasTitle: true,
      legend: 'none',
    });
    expect(titleRect).not.toBeNull();
    expect(plot.y).toBe(PAD.top + LAYOUT_CONSTANTS.TITLE_HEIGHT);
  });

  it('clamps plot to non-negative dimensions', () => {
    const { plot } = computeLayout({
      width: 20,
      height: 20,
      padding: PAD,
      hasLeftAxis: true,
      hasRightAxis: true,
      hasXAxis: true,
      hasTitle: true,
      legend: 'bottom',
    });
    expect(plot.width).toBeGreaterThanOrEqual(0);
    expect(plot.height).toBeGreaterThanOrEqual(0);
  });
});
