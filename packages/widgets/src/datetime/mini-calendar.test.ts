/** jsdom unit test for MiniCalendar — render, keyboard navigation, selection event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MiniCalendar } from './mini-calendar.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('MiniCalendar (jsdom)', () => {
  it('renders a month grid with a title and 42 day cells', () => {
    const c = new MiniCalendar(host, { viewDate: new Date(2026, 5, 15) });
    expect(host.querySelector('.jects-minical')).toBeTruthy();
    expect(host.querySelector('.jects-minical__title')!.textContent).toContain('June 2026');
    expect(host.querySelectorAll('.jects-minical__day').length).toBe(42);
    c.destroy();
  });

  it('marks the selected day with aria-selected on its gridcell', () => {
    const value = new Date(2026, 5, 10);
    const c = new MiniCalendar(host, { value, viewDate: value });
    const selected = host.querySelector('.jects-minical__day--selected') as HTMLElement;
    expect(selected).toBeTruthy();
    expect(selected.getAttribute('data-date')).toBe('2026-06-10');
    // aria-selected lives on the role=gridcell wrapper (selection state belongs
    // on the cell, not the interactive button inside it).
    const cell = selected.closest('[role="gridcell"]') as HTMLElement;
    expect(cell).toBeTruthy();
    expect(cell.getAttribute('aria-selected')).toBe('true');
    c.destroy();
  });

  it('disables days outside the min/max range', () => {
    const c = new MiniCalendar(host, {
      viewDate: new Date(2026, 5, 15),
      min: new Date(2026, 5, 10),
      max: new Date(2026, 5, 20),
    });
    const before = host.querySelector('[data-date="2026-06-05"]') as HTMLButtonElement;
    const inside = host.querySelector('[data-date="2026-06-15"]') as HTMLButtonElement;
    expect(before.disabled).toBe(true);
    expect(inside.disabled).toBe(false);
    c.destroy();
  });

  it('emits change when a day is clicked', () => {
    const c = new MiniCalendar(host, { viewDate: new Date(2026, 5, 15) });
    const spy = vi.fn();
    c.on('change', spy);
    (host.querySelector('[data-date="2026-06-12"]') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].value.getDate()).toBe(12);
    expect(c.getValue()!.getDate()).toBe(12);
    c.destroy();
  });

  it('beforeChange veto cancels selection', () => {
    const c = new MiniCalendar(host, { viewDate: new Date(2026, 5, 15) });
    const changeSpy = vi.fn();
    c.on('beforeChange', () => false);
    c.on('change', changeSpy);
    (host.querySelector('[data-date="2026-06-12"]') as HTMLButtonElement).click();
    expect(changeSpy).not.toHaveBeenCalled();
    expect(c.getValue()).toBeNull();
    c.destroy();
  });

  it('ArrowRight keyboard navigation moves focus to the next day', () => {
    const value = new Date(2026, 5, 10);
    const c = new MiniCalendar(host, { value, viewDate: value });
    const grid = host.querySelector('.jects-minical') as HTMLElement;
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const focused = host.querySelector('.jects-minical__day[tabindex="0"]') as HTMLElement;
    expect(focused.getAttribute('data-date')).toBe('2026-06-11');
    c.destroy();
  });

  it('PageDown advances to the next month', () => {
    const value = new Date(2026, 5, 10);
    const c = new MiniCalendar(host, { value, viewDate: value });
    const grid = host.querySelector('.jects-minical') as HTMLElement;
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    expect(host.querySelector('.jects-minical__title')!.textContent).toContain('July 2026');
    c.destroy();
  });

  it('respects weekStart=1 (Monday first)', () => {
    const c = new MiniCalendar(host, { viewDate: new Date(2026, 5, 15), weekStart: 1 });
    const firstHeader = host.querySelector('.jects-minical__weekday')!;
    expect(firstHeader.textContent).toBe('Mo');
    c.destroy();
  });

  it('Home moves to the visible row start for a Sunday-first grid', () => {
    // June 10 2026 is a Wednesday; with weekStart=0 the row starts on Sunday June 7.
    const value = new Date(2026, 5, 10);
    const c = new MiniCalendar(host, { value, viewDate: value, weekStart: 0 });
    const grid = host.querySelector('.jects-minical') as HTMLElement;
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    const focused = host.querySelector('.jects-minical__day[tabindex="0"]') as HTMLElement;
    expect(focused.getAttribute('data-date')).toBe('2026-06-07');
    c.destroy();
  });

  it('Home/End respect weekStart=1 (Monday-first row bounds)', () => {
    // June 10 2026 is a Wednesday; with weekStart=1 the row is Mon Jun 8 .. Sun Jun 14.
    const value = new Date(2026, 5, 10);
    const c = new MiniCalendar(host, { value, viewDate: value, weekStart: 1 });
    const grid = host.querySelector('.jects-minical') as HTMLElement;
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect((host.querySelector('.jects-minical__day[tabindex="0"]') as HTMLElement).getAttribute('data-date')).toBe(
      '2026-06-08',
    );
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect((host.querySelector('.jects-minical__day[tabindex="0"]') as HTMLElement).getAttribute('data-date')).toBe(
      '2026-06-14',
    );
    c.destroy();
  });

  it('exposes a single role=grid with named gridcells and visible columnheaders', () => {
    const c = new MiniCalendar(host, { viewDate: new Date(2026, 5, 15) });
    const root = host.querySelector('.jects-minical') as HTMLElement;
    expect(root.getAttribute('role')).toBeNull();
    expect(host.querySelectorAll('[role="grid"]').length).toBe(1);
    expect(host.querySelectorAll('[role="gridcell"]').length).toBe(42);
    const headers = host.querySelectorAll('[role="columnheader"]');
    expect(headers.length).toBe(7);
    headers.forEach((h) => expect(h.getAttribute('aria-hidden')).toBeNull());
    c.destroy();
  });

  it('destroy removes the element', () => {
    const c = new MiniCalendar(host, {});
    c.destroy();
    expect(host.querySelector('.jects-minical')).toBeNull();
  });
});
