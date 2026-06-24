import { describe, it, expect, vi } from 'vitest';
import { signal, computed, effect, batch, untracked } from './signals.js';

describe('signal', () => {
  it('gets and sets .value', () => {
    const s = signal(1);
    expect(s.value).toBe(1);
    s.value = 2;
    expect(s.value).toBe(2);
  });

  it('peek does not register a dependency', () => {
    const s = signal(0);
    const spy = vi.fn();
    effect(() => {
      spy(s.peek());
    });
    expect(spy).toHaveBeenCalledTimes(1);
    s.value = 5;
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('effect', () => {
  it('runs immediately and re-runs on dependency change', () => {
    const s = signal(0);
    const spy = vi.fn();
    effect(() => spy(s.value));
    expect(spy).toHaveBeenCalledTimes(1);
    s.value = 1;
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(1);
  });

  it('does not re-run when set to an equal value', () => {
    const s = signal(1);
    const spy = vi.fn();
    effect(() => spy(s.value));
    s.value = 1;
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('disposer stops further runs', () => {
    const s = signal(0);
    const spy = vi.fn();
    const dispose = effect(() => spy(s.value));
    dispose();
    s.value = 1;
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('tracks dynamic dependencies', () => {
    const a = signal(true);
    const b = signal('b');
    const c = signal('c');
    const spy = vi.fn();
    effect(() => spy(a.value ? b.value : c.value));
    expect(spy).toHaveBeenCalledTimes(1);
    // c is not a dependency yet
    c.value = 'c2';
    expect(spy).toHaveBeenCalledTimes(1);
    // switch branch
    a.value = false;
    expect(spy).toHaveBeenCalledTimes(2);
    // now c is a dependency, b is not
    b.value = 'b2';
    expect(spy).toHaveBeenCalledTimes(2);
    c.value = 'c3';
    expect(spy).toHaveBeenCalledTimes(3);
  });
});

describe('computed', () => {
  it('derives and caches', () => {
    const a = signal(2);
    const b = signal(3);
    const compute = vi.fn(() => a.value + b.value);
    const sum = computed(compute);
    expect(sum.value).toBe(5);
    expect(sum.value).toBe(5);
    expect(compute).toHaveBeenCalledTimes(1); // cached
    a.value = 10;
    expect(sum.value).toBe(13);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('feeds effects', () => {
    const a = signal(1);
    const double = computed(() => a.value * 2);
    const spy = vi.fn();
    effect(() => spy(double.value));
    expect(spy).toHaveBeenLastCalledWith(2);
    a.value = 5;
    expect(spy).toHaveBeenLastCalledWith(10);
  });
});

describe('batch', () => {
  it('coalesces multiple writes into one effect run', () => {
    const a = signal(0);
    const b = signal(0);
    const spy = vi.fn();
    effect(() => spy(a.value + b.value));
    expect(spy).toHaveBeenCalledTimes(1);
    batch(() => {
      a.value = 1;
      b.value = 2;
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(3);
  });
});

describe('untracked', () => {
  it('reads without registering dependency', () => {
    const a = signal(1);
    const b = signal(1);
    const spy = vi.fn();
    effect(() => spy(a.value + untracked(() => b.value)));
    b.value = 99;
    expect(spy).toHaveBeenCalledTimes(1);
    a.value = 2;
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
