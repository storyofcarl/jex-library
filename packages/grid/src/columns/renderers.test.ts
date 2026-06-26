/** jsdom unit tests — typed cell renderers + registry resolution. */
import { describe, it, expect } from 'vitest';
import {
  CellRendererRegistry,
  formatNumber,
  formatDate,
  toDate,
  textRenderer,
  numberRenderer,
  checkRenderer,
  actionRenderer,
  type CellAction,
} from './renderers.js';
import type { Model } from '@jects/core';
import type { CellRenderContext, ColumnDef, GridApi } from '../contract.js';

function ctx<Row extends Model>(
  partial: Partial<CellRenderContext<Row>> & { column: ColumnDef<Row>; value: unknown },
): CellRenderContext<Row> {
  return {
    row: ({} as Row),
    rowIndex: 0,
    colIndex: 0,
    el: document.createElement('div'),
    api: ({} as GridApi<Row>),
    ...partial,
  } as CellRenderContext<Row>;
}

describe('formatters', () => {
  it('formatNumber applies precision + grouping', () => {
    expect(formatNumber(1234.5, { precision: 2 })).toBe('1,234.50');
    expect(formatNumber(1000, { grouping: false })).toBe('1000');
    expect(formatNumber(null)).toBe('');
    expect(formatNumber('abc')).toBe('abc');
  });

  it('toDate / formatDate handle Date, ISO string, and invalid', () => {
    expect(toDate('2024-01-15')?.getUTCFullYear()).toBe(2024);
    expect(toDate('not-a-date')).toBeNull();
    expect(toDate(null)).toBeNull();
    expect(formatDate('')).toBe('');
    expect(formatDate(new Date('2024-01-15'), { dateStyle: 'short' })).toMatch(/24|2024/);
  });
});

describe('built-in renderers', () => {
  it('textRenderer sets textContent', () => {
    const c = ctx({ column: { field: 'name' }, value: 'Ada' });
    textRenderer(c);
    expect(c.el.textContent).toBe('Ada');
  });

  it('numberRenderer formats + adds number class', () => {
    const c = ctx({ column: { field: 'n', type: 'number', meta: { format: { precision: 1 } } }, value: 3 });
    numberRenderer(c);
    expect(c.el.textContent).toBe('3.0');
    expect(c.el.classList.contains('jects-grid-cell--number')).toBe(true);
  });

  it('checkRenderer renders an on/off mark with aria-label', () => {
    const on = ctx({ column: { field: 'b', type: 'check' }, value: true });
    checkRenderer(on);
    const mark = on.el.querySelector('.jects-grid-cell__check')!;
    expect(mark.classList.contains('jects-grid-cell__check--on')).toBe(true);
    expect(mark.getAttribute('aria-label')).toBe('checked');

    const off = ctx({ column: { field: 'b', type: 'check' }, value: false });
    checkRenderer(off);
    expect(off.el.querySelector('.jects-grid-cell__check--on')).toBeNull();
  });

  it('actionRenderer renders buttons that fire onClick', () => {
    let clicked = '';
    const actions: CellAction[] = [
      { key: 'edit', label: 'Edit', onClick: () => (clicked = 'edit') },
      { key: 'del', label: 'Delete' },
    ];
    const c = ctx({ column: { type: 'action', meta: { actions } }, value: undefined });
    actionRenderer(c);
    const btns = c.el.querySelectorAll('button');
    expect(btns).toHaveLength(2);
    expect(btns[0]!.getAttribute('data-action')).toBe('edit');
    btns[0]!.click();
    expect(clicked).toBe('edit');
  });
});

describe('CellRendererRegistry.resolve', () => {
  it('per-column renderer wins over type', () => {
    const reg = new CellRendererRegistry();
    const custom = () => 'X';
    expect(reg.resolve({ field: 'a', type: 'number', renderer: custom })).toBe(custom);
  });

  it('resolves the built-in renderer by type', () => {
    const reg = new CellRendererRegistry();
    expect(reg.resolve({ field: 'a', type: 'number' })).toBe(numberRenderer);
    expect(reg.resolve({ field: 'a' })).toBe(textRenderer); // default text
  });

  it('template without a renderer paints empty', () => {
    const reg = new CellRendererRegistry();
    const c = ctx({ column: { type: 'template' }, value: 'ignored' });
    reg.paint(c);
    expect(c.el.textContent).toBe('');
  });

  it('paint applies string/element/void return forms', () => {
    const reg = new CellRendererRegistry();
    reg.register('text', (cc) => `<${cc.value}>` as unknown as string);
    const c = ctx({ column: { field: 'a', type: 'text' }, value: 'hi' });
    reg.paint(c);
    expect(c.el.textContent).toBe('<hi>');
  });

  it('custom registered renderer overrides default', () => {
    const reg = new CellRendererRegistry();
    reg.register('number', (cc) => {
      cc.el.textContent = `#${cc.value}`;
    });
    const c = ctx({ column: { field: 'a', type: 'number' }, value: 9 });
    reg.paint(c);
    expect(c.el.textContent).toBe('#9');
  });
});
