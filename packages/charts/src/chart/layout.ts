/**
 * Layout — compute the plot rectangle inside the chart, reserving space for
 * axes, the title, and the legend. Pure math, unit-tested.
 */
import type { Insets } from './types.js';

export interface LayoutInput {
  width: number;
  height: number;
  padding: Insets;
  hasLeftAxis: boolean;
  hasRightAxis: boolean;
  hasXAxis: boolean;
  hasTitle: boolean;
  legend: 'top' | 'bottom' | 'left' | 'right' | 'none';
}

export interface PlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChartLayout {
  plot: PlotRect;
  legendRect: PlotRect | null;
  titleRect: PlotRect | null;
}

const AXIS_Y_WIDTH = 44; // space for y tick labels + title
const AXIS_X_HEIGHT = 32;
const TITLE_HEIGHT = 28;
const LEGEND_BAND = 32;
const LEGEND_SIDE = 96;

export function computeLayout(input: LayoutInput): ChartLayout {
  const { width, height, padding } = input;
  let top = padding.top;
  let right = padding.right;
  let bottom = padding.bottom;
  let left = padding.left;

  let titleRect: PlotRect | null = null;
  if (input.hasTitle) {
    titleRect = { x: left, y: top, width: width - left - right, height: TITLE_HEIGHT };
    top += TITLE_HEIGHT;
  }

  let legendRect: PlotRect | null = null;
  switch (input.legend) {
    case 'top':
      legendRect = { x: left, y: top, width: width - left - right, height: LEGEND_BAND };
      top += LEGEND_BAND;
      break;
    case 'bottom':
      legendRect = {
        x: left,
        y: height - bottom - LEGEND_BAND,
        width: width - left - right,
        height: LEGEND_BAND,
      };
      bottom += LEGEND_BAND;
      break;
    case 'left':
      legendRect = { x: left, y: top, width: LEGEND_SIDE, height: height - top - bottom };
      left += LEGEND_SIDE;
      break;
    case 'right':
      legendRect = {
        x: width - right - LEGEND_SIDE,
        y: top,
        width: LEGEND_SIDE,
        height: height - top - bottom,
      };
      right += LEGEND_SIDE;
      break;
    case 'none':
      break;
  }

  if (input.hasLeftAxis) left += AXIS_Y_WIDTH;
  if (input.hasRightAxis) right += AXIS_Y_WIDTH;
  if (input.hasXAxis) bottom += AXIS_X_HEIGHT;

  const plot: PlotRect = {
    x: left,
    y: top,
    width: Math.max(width - left - right, 0),
    height: Math.max(height - top - bottom, 0),
  };

  return { plot, legendRect, titleRect };
}

export const LAYOUT_CONSTANTS = {
  AXIS_Y_WIDTH,
  AXIS_X_HEIGHT,
  TITLE_HEIGHT,
  LEGEND_BAND,
  LEGEND_SIDE,
} as const;
