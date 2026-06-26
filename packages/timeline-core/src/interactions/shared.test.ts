/** jsdom unit tests for the interactions shared helpers. */
import { describe, it, expect } from 'vitest';
import {
  Disposers,
  addListener,
  clamp,
  snapTime,
  spanDuration,
  shiftSpan,
  pxToDelta,
  spansEqual,
} from './shared.js';
import { TestAxis } from './test-harness.js';

describe('Disposers', () => {
  it('runs disposers in reverse order, exactly once', () => {
    const log: number[] = [];
    const d = new Disposers();
    d.add(() => log.push(1));
    d.add(() => log.push(2));
    d.add(() => log.push(3));
    expect(d.size).toBe(3);
    d.dispose();
    expect(log).toEqual([3, 2, 1]);
    d.dispose();
    expect(log).toEqual([3, 2, 1]);
    expect(d.disposed).toBe(true);
  });

  it('runs a disposer immediately if added after disposal', () => {
    const d = new Disposers();
    d.dispose();
    let ran = false;
    d.add(() => (ran = true));
    expect(ran).toBe(true);
  });

  it('a throwing disposer does not abort the rest', () => {
    const log: number[] = [];
    const d = new Disposers();
    d.add(() => log.push(1));
    d.add(() => {
      throw new Error('boom');
    });
    d.add(() => log.push(3));
    d.dispose();
    expect(log).toEqual([3, 1]);
  });
});

describe('addListener', () => {
  it('binds and returns a disposer that removes the listener', () => {
    const el = document.createElement('div');
    let count = 0;
    const off = addListener(el, 'click', () => count++);
    el.dispatchEvent(new Event('click'));
    expect(count).toBe(1);
    off();
    el.dispatchEvent(new Event('click'));
    expect(count).toBe(1);
  });
});

describe('geometry helpers', () => {
  const axis = new TestAxis(0.01, 1000, 0);

  it('clamp handles normal and inverted bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
    expect(clamp(5, 10, 0)).toBe(5);
  });

  it('snapTime delegates to axis.snap unless disabled', () => {
    expect(snapTime(axis, 1300)).toBe(1000);
    expect(snapTime(axis, 1300, false)).toBe(1300);
  });

  it('spanDuration / shiftSpan', () => {
    expect(spanDuration({ start: 1000, end: 3000 })).toBe(2000);
    expect(spanDuration({ start: 3000, end: 1000 })).toBe(0);
    expect(shiftSpan({ start: 1000, end: 3000 }, 500)).toEqual({ start: 1500, end: 3500 });
  });

  it('pxToDelta converts pixels to a time delta', () => {
    expect(pxToDelta(axis, 10)).toBe(1000);
  });

  it('spansEqual', () => {
    expect(spansEqual({ start: 1, end: 2 }, { start: 1, end: 2 })).toBe(true);
    expect(spansEqual({ start: 1, end: 2 }, { start: 1, end: 3 })).toBe(false);
  });
});
