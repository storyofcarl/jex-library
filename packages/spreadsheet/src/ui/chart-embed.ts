/**
 * Embedded charts — derive a `@jects/charts` `Chart` from a rectangular range of
 * sheet values and mount it as a floating object over the grid.
 *
 * Range → chart mapping (the conventional spreadsheet "insert chart from
 * selection" behaviour):
 *   - The first column is taken as the category axis (labels) when it is
 *     non-numeric; otherwise categories are 1..n.
 *   - Each remaining column becomes a data series (its header cell, when the
 *     first row is textual, is the series name).
 *   - A textual first row is treated as a header row (series names / skipped for
 *     data); an all-numeric block uses positional categories and "Series N".
 *
 * Pure-ish: {@link rangeToChartData} is a DOM-free transform unit-tested on its
 * own; {@link createEmbeddedChart} constructs the actual Chart widget.
 */

import { Chart, type ChartConfig, type ChartType, type SeriesConfig } from '@jects/charts';
import type { CellValue } from '../contract.js';

/** The chart-ready data extracted from a value block. */
export interface ChartData {
  categories: Array<string | number>;
  series: SeriesConfig[];
}

function toNumber(v: CellValue): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function isText(v: CellValue): boolean {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * Convert a 2D block of cell values into chart categories + series. `type` is
 * the chart type, used to decide whether the first column is a category axis
 * (cartesian) or slice labels (pie/donut).
 */
export function rangeToChartData(block: CellValue[][], type: ChartType): ChartData {
  if (block.length === 0) return { categories: [], series: [] };

  // Header row = a first row that is entirely (non-blank) text.
  const firstRow = block[0]!;
  const hasHeaderRow =
    block.length > 1 && firstRow.every((v) => v === null || v === '' || isText(v)) &&
    firstRow.some((v) => isText(v));
  const bodyRows = hasHeaderRow ? block.slice(1) : block;
  if (bodyRows.length === 0) return { categories: [], series: [] };

  // Label column = a first column whose body cells are (mostly) text.
  const firstColIsLabel = bodyRows.some((r) => isText(r[0] ?? null));
  const seriesStartCol = firstColIsLabel ? 1 : 0;

  const categories: Array<string | number> = bodyRows.map((r, i) =>
    firstColIsLabel ? String(r[0] ?? '') : i + 1,
  );

  const colCount = Math.max(...block.map((r) => r.length));
  const series: SeriesConfig[] = [];
  for (let c = seriesStartCol; c < colCount; c++) {
    const data = bodyRows.map((r) => toNumber(r[c] ?? 0));
    const name = hasHeaderRow && isText(firstRow[c] ?? null)
      ? String(firstRow[c])
      : `Series ${c - seriesStartCol + 1}`;
    series.push({ name, data });
  }
  void type;
  return { categories, series };
}

/** Options for {@link createEmbeddedChart}. */
export interface EmbeddedChartOptions {
  /** Chart type. Default `'bar'`. */
  type?: ChartType;
  /** Pixel width of the floating chart. Default 360. */
  width?: number;
  /** Pixel height. Default 240. */
  height?: number;
}

/**
 * Build a `Chart` widget from a value block, mounted into `host`. Returns the
 * Chart instance (the caller owns positioning + teardown).
 */
export function createEmbeddedChart(
  host: HTMLElement,
  block: CellValue[][],
  options: EmbeddedChartOptions = {},
): Chart {
  const type = options.type ?? 'bar';
  const { categories, series } = rangeToChartData(block, type);
  const config: ChartConfig = {
    type,
    categories,
    series,
    width: options.width ?? 360,
    height: options.height ?? 240,
  };
  return new Chart(host, config);
}
