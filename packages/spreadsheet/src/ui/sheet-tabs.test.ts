/** jsdom unit test for the SheetTabs strip. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SheetTabs } from './sheet-tabs.js';
import { createSpreadsheetApi, defaultWorkbook } from './engine.js';
import type { SpreadsheetApi } from '../contract.js';

let host: HTMLElement;
let api: SpreadsheetApi;
let tabs: SheetTabs;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  api = createSpreadsheetApi(defaultWorkbook());
  api.addSheet('Data');
  tabs = new SheetTabs(host, { api });
});
afterEach(() => {
  tabs.destroy();
  host.remove();
});

describe('SheetTabs (jsdom)', () => {
  it('renders a tablist with one tab per sheet', () => {
    expect(host.querySelector('[role="tablist"]')).toBeTruthy();
    expect(host.querySelectorAll('[role="tab"]').length).toBe(2);
  });

  it('marks the active tab as selected', () => {
    const active = host.querySelector('[aria-selected="true"]');
    expect(active?.querySelector('.jects-stabs__label')?.textContent).toBe('Sheet1');
  });

  it('emits activate when a tab is clicked', () => {
    const spy = vi.fn();
    tabs.on('activate', spy);
    const tabEls = host.querySelectorAll('[role="tab"]');
    (tabEls[1] as HTMLElement).click();
    expect(spy).toHaveBeenCalled();
  });

  it('emits add when the + button is pressed', () => {
    const spy = vi.fn();
    tabs.on('add', spy);
    (host.querySelector('.jects-stabs__add') as HTMLElement).click();
    expect(spy).toHaveBeenCalled();
  });

  it('emits remove when the close button is pressed', () => {
    const spy = vi.fn();
    tabs.on('remove', spy);
    (host.querySelector('.jects-stabs__close') as HTMLElement).click();
    expect(spy).toHaveBeenCalled();
  });
});
