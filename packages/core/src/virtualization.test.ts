import { describe, it, expect } from 'vitest';
import { computeWindow, OffsetIndex } from './virtualization.js';

describe('computeWindow', () => {
  it('computes window at top', () => {
    const r = computeWindow({ scrollTop: 0, viewportHeight: 100, itemSize: 20, count: 100, overscan: 2 });
    expect(r.startIndex).toBe(0);
    expect(r.offset).toBe(0);
    expect(r.totalSize).toBe(2000);
    // 5 visible + 2 overscan
    expect(r.endIndex).toBe(7);
  });

  it('computes window when scrolled', () => {
    const r = computeWindow({ scrollTop: 200, viewportHeight: 100, itemSize: 20, count: 100, overscan: 1 });
    // firstVisible = 10, overscan 1 -> start 9
    expect(r.startIndex).toBe(9);
    expect(r.offset).toBe(9 * 20);
  });

  it('clamps at the bottom', () => {
    const r = computeWindow({ scrollTop: 99999, viewportHeight: 100, itemSize: 20, count: 10, overscan: 0 });
    expect(r.endIndex).toBe(9);
  });

  it('handles empty', () => {
    const r = computeWindow({ scrollTop: 0, viewportHeight: 100, itemSize: 20, count: 0 });
    expect(r.endIndex).toBe(-1);
    expect(r.totalSize).toBe(0);
  });
});

describe('OffsetIndex', () => {
  it('computes prefix offsets with a default size', () => {
    const idx = new OffsetIndex(5, 10);
    expect(idx.total()).toBe(50);
    expect(idx.offsetOf(0)).toBe(0);
    expect(idx.offsetOf(3)).toBe(30);
  });

  it('updates a size and reflects in offsets/total', () => {
    const idx = new OffsetIndex(5, 10);
    idx.setSize(2, 30); // +20
    expect(idx.total()).toBe(70);
    expect(idx.offsetOf(2)).toBe(20);
    expect(idx.offsetOf(3)).toBe(50);
  });

  it('indexAt finds the row spanning a pixel', () => {
    const idx = new OffsetIndex(4, 0);
    idx.setSize(0, 10);
    idx.setSize(1, 20);
    idx.setSize(2, 30);
    idx.setSize(3, 40);
    // offsets: [0,10,30,60], total 100
    expect(idx.indexAt(0)).toBe(0);
    expect(idx.indexAt(5)).toBe(0);
    expect(idx.indexAt(10)).toBe(1);
    expect(idx.indexAt(29)).toBe(1);
    expect(idx.indexAt(30)).toBe(2);
    expect(idx.indexAt(59)).toBe(2);
    expect(idx.indexAt(60)).toBe(3);
    expect(idx.indexAt(1000)).toBe(3);
  });

  it('variable sizes integrate with sizeOf', () => {
    const idx = new OffsetIndex(3, 0);
    idx.setSize(0, 7);
    idx.setSize(1, 13);
    expect(idx.sizeOf(0)).toBe(7);
    expect(idx.sizeOf(1)).toBe(13);
    expect(idx.offsetOf(2)).toBe(20);
  });
});
