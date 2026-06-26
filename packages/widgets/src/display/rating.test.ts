/** jsdom unit test for Rating — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Rating } from './rating.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Rating (jsdom)', () => {
  it('renders the right number of stars with slider role', () => {
    const r = new Rating(host, { max: 5, value: 3 });
    expect(host.querySelectorAll('.jects-rating__star').length).toBe(5);
    expect(host.querySelector('.jects-rating')!.getAttribute('role')).toBe('slider');
    expect(host.querySelector('.jects-rating')!.getAttribute('aria-valuenow')).toBe('3');
    expect(host.querySelectorAll('.jects-rating__star--full').length).toBe(3);
    r.destroy();
  });

  it('supports half stars', () => {
    const r = new Rating(host, { max: 5, value: 2.5, allowHalf: true });
    expect(host.querySelectorAll('.jects-rating__star--full').length).toBe(2);
    expect(host.querySelectorAll('.jects-rating__star--half').length).toBe(1);
    r.destroy();
  });

  it('clicking a star sets the value and emits change', () => {
    const r = new Rating(host, { max: 5, value: 0 });
    const spy = vi.fn();
    r.on('change', spy);
    const star = host.querySelectorAll('.jects-rating__star')[3] as HTMLElement; // 4th
    star.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(r.getConfig().value).toBe(4);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].value).toBe(4);
    r.destroy();
  });

  it('keyboard ArrowRight increments', () => {
    const r = new Rating(host, { max: 5, value: 2 });
    host.querySelector('.jects-rating')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight' }),
    );
    expect(r.getConfig().value).toBe(3);
    r.destroy();
  });

  it('readonly blocks interaction', () => {
    const r = new Rating(host, { max: 5, value: 2, readOnly: true });
    const star = host.querySelectorAll('.jects-rating__star')[4] as HTMLElement;
    star.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(r.getConfig().value).toBe(2);
    r.destroy();
  });

  it('beforeChange veto cancels', () => {
    const r = new Rating(host, { max: 5, value: 1 });
    r.on('beforeChange', () => false);
    const star = host.querySelectorAll('.jects-rating__star')[3] as HTMLElement;
    star.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(r.getConfig().value).toBe(1);
    r.destroy();
  });

  it('destroy removes the element', () => {
    const r = new Rating(host, { value: 3 });
    r.destroy();
    expect(host.querySelector('.jects-rating')).toBeNull();
  });
});
