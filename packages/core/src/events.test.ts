import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from './events.js';

interface TestEvents extends Record<string, unknown> {
  beforeClick: { x: number };
  click: { x: number };
}

describe('EventEmitter', () => {
  it('on/emit delivers payloads', () => {
    const e = new EventEmitter<TestEvents>();
    const spy = vi.fn();
    e.on('click', spy);
    e.emit('click', { x: 1 });
    expect(spy).toHaveBeenCalledWith({ x: 1 });
  });

  it('off removes a specific handler', () => {
    const e = new EventEmitter<TestEvents>();
    const spy = vi.fn();
    e.on('click', spy);
    e.off('click', spy);
    e.emit('click', { x: 1 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('disposer from on() removes the handler', () => {
    const e = new EventEmitter<TestEvents>();
    const spy = vi.fn();
    const dispose = e.on('click', spy);
    dispose();
    e.emit('click', { x: 1 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('once fires exactly once', () => {
    const e = new EventEmitter<TestEvents>();
    const spy = vi.fn();
    e.once('click', spy);
    e.emit('click', { x: 1 });
    e.emit('click', { x: 2 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('beforeX veto: returns false if any handler returns false', () => {
    const e = new EventEmitter<TestEvents>();
    e.on('beforeClick', () => true);
    e.on('beforeClick', () => false);
    expect(e.emit('beforeClick', { x: 1 })).toBe(false);
  });

  it('beforeX returns true when no veto', () => {
    const e = new EventEmitter<TestEvents>();
    e.on('beforeClick', () => undefined);
    expect(e.emit('beforeClick', { x: 1 })).toBe(true);
  });

  it('emit with no handlers returns true', () => {
    const e = new EventEmitter<TestEvents>();
    expect(e.emit('click', { x: 1 })).toBe(true);
  });

  it('handler id replaces a previous registration with same id', () => {
    const e = new EventEmitter<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    e.on('click', a, { id: 'h' });
    e.on('click', b, { id: 'h' });
    e.emit('click', { x: 1 });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(e.listenerCount('click')).toBe(1);
  });

  it('off by id removes', () => {
    const e = new EventEmitter<TestEvents>();
    const spy = vi.fn();
    e.on('click', spy, { id: 'x' });
    e.off('click', undefined, 'x');
    e.emit('click', { x: 1 });
    expect(spy).not.toHaveBeenCalled();
  });
});
