/**
 * jsdom unit tests for the UndoRedoController — the plugin that wires the STM to
 * a live scheduler (event + dependency stores, Ctrl/⌘+Z / Ctrl/⌘+Y keyboard,
 * live-region announce, auto-dispose on host destroy). Driven against a fake
 * structural host backed by real `@jects/core` stores.
 */
import { describe, it, expect } from 'vitest';
import { Store, EventEmitter } from '@jects/core';
import type { EventModel, DependencyModel, AssignmentModel } from '../contract.js';
import { UndoRedoController, installUndoRedo, type UndoRedoHost } from './undo-redo.js';

const HOUR = 3_600_000;
const T0 = Date.UTC(2025, 0, 6, 9);

function evt(id: string, start: number, hours: number): EventModel {
  return { id, resourceId: 'r', name: id, startDate: start, endDate: start + hours * HOUR };
}

class FakeScheduler implements UndoRedoHost {
  readonly el: HTMLElement;
  readonly events = new Store<EventModel>({ data: [evt('a', T0, 4)], idField: 'id' });
  readonly deps = new Store<DependencyModel>({ idField: 'id' });
  private readonly emitter = new EventEmitter();
  isDestroyed = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'jects-scheduler';
    const live = document.createElement('div');
    live.className = 'jects-scheduler__live';
    this.el.appendChild(live);
    const bars = document.createElement('div');
    bars.className = 'jects-scheduler__bars';
    this.el.appendChild(bars);
    document.body.appendChild(this.el);
  }
  getEventStore(): Store<EventModel> {
    return this.events;
  }
  getDependencyStore(): Store<DependencyModel> {
    return this.deps;
  }
  on<E extends string>(event: E, fn: (p: never) => unknown): () => void {
    return this.emitter.on(event as never, fn as never);
  }
  fireDestroy(): void {
    this.isDestroyed = true;
    this.emitter.emit('destroy' as never, { widget: this } as never);
  }
  liveText(): string {
    return this.el.querySelector('.jects-scheduler__live')!.textContent ?? '';
  }
  addBar(id: string): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'jects-scheduler__bar';
    bar.dataset.eventId = id;
    this.el.querySelector('.jects-scheduler__bars')!.appendChild(bar);
    return bar;
  }
  cleanup(): void {
    this.el.remove();
  }
}

function key(host: FakeScheduler, k: string, opts: { shift?: boolean; meta?: boolean } = {}): void {
  host.el.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: k,
      ctrlKey: !opts.meta,
      metaKey: !!opts.meta,
      shiftKey: !!opts.shift,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe('UndoRedoController — store wiring', () => {
  it('tracks event + dependency stores out of the box', () => {
    const host = new FakeScheduler();
    const ctl = installUndoRedo(host);

    ctl.transact('move', () => host.events.update('a', { startDate: T0 + HOUR }));
    expect(ctl.canUndo).toBe(true);
    ctl.undo();
    expect(host.events.getById('a')!.startDate).toBe(T0);

    ctl.transact('link', () => host.deps.add({ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }));
    ctl.undo();
    expect(host.deps.getById('d')).toBeUndefined();

    ctl.destroy();
    host.cleanup();
  });

  it('tracks an extra (assignment) store passed in config', () => {
    const host = new FakeScheduler();
    const assignments = new Store<AssignmentModel>({ idField: 'id' });
    const ctl = installUndoRedo(host, {
      extraStores: [{ name: 'assignments', store: assignments }],
    });

    ctl.transact('assign', () => assignments.add({ id: 's1', eventId: 'a', resourceId: 'r2' }));
    expect(assignments.getById('s1')).toBeDefined();
    ctl.undo();
    expect(assignments.getById('s1')).toBeUndefined();

    ctl.destroy();
    host.cleanup();
  });
});

describe('UndoRedoController — keyboard', () => {
  it('Ctrl+Z undoes and Ctrl+Y redoes', () => {
    const host = new FakeScheduler();
    const ctl = installUndoRedo(host);
    ctl.transact('move', () => host.events.update('a', { startDate: T0 + HOUR }));

    key(host, 'z');
    expect(host.events.getById('a')!.startDate).toBe(T0);
    key(host, 'y');
    expect(host.events.getById('a')!.startDate).toBe(T0 + HOUR);

    ctl.destroy();
    host.cleanup();
  });

  it('Ctrl+Shift+Z also redoes (editor convention)', () => {
    const host = new FakeScheduler();
    const ctl = installUndoRedo(host);
    ctl.transact('move', () => host.events.update('a', { startDate: T0 + HOUR }));
    key(host, 'z');
    expect(host.events.getById('a')!.startDate).toBe(T0);
    key(host, 'z', { shift: true });
    expect(host.events.getById('a')!.startDate).toBe(T0 + HOUR);
    ctl.destroy();
    host.cleanup();
  });

  it('Meta+Z (mac) works', () => {
    const host = new FakeScheduler();
    const ctl = installUndoRedo(host);
    ctl.transact('move', () => host.events.update('a', { startDate: T0 + HOUR }));
    key(host, 'z', { meta: true });
    expect(host.events.getById('a')!.startDate).toBe(T0);
    ctl.destroy();
    host.cleanup();
  });

  it('preventDefault is called when there is something to undo', () => {
    const host = new FakeScheduler();
    const ctl = installUndoRedo(host);
    ctl.transact('move', () => host.events.update('a', { startDate: T0 + HOUR }));
    const e = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true });
    host.el.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    ctl.destroy();
    host.cleanup();
  });

  it('keyboard can be disabled', () => {
    const host = new FakeScheduler();
    const ctl = installUndoRedo(host, { keyboard: false });
    ctl.transact('move', () => host.events.update('a', { startDate: T0 + HOUR }));
    key(host, 'z');
    expect(host.events.getById('a')!.startDate).toBe(T0 + HOUR); // unchanged
    ctl.destroy();
    host.cleanup();
  });
});

describe('UndoRedoController — announce + flash + lifecycle', () => {
  it('announces undo/redo through the live region', () => {
    const host = new FakeScheduler();
    const ctl = installUndoRedo(host);
    ctl.transact('Move event', () => host.events.update('a', { startDate: T0 + HOUR }));
    ctl.undo();
    expect(host.liveText()).toMatch(/Undo/);
    ctl.redo();
    expect(host.liveText()).toMatch(/Redo/);
    ctl.destroy();
    host.cleanup();
  });

  it('flashes the affected event bar on undo, then clears', async () => {
    const host = new FakeScheduler();
    const ctl = installUndoRedo(host);
    host.addBar('a');
    ctl.transact('Move event', () => host.events.update('a', { startDate: T0 + HOUR }));
    ctl.undo();
    const bar = host.el.querySelector('[data-event-id="a"]') as HTMLElement;
    expect(bar.classList.contains('jects-scheduler__bar--reverted')).toBe(true);
    await new Promise((r) => setTimeout(r, 650));
    expect(bar.classList.contains('jects-scheduler__bar--reverted')).toBe(false);
    ctl.destroy();
    host.cleanup();
  });

  it('exposes the underlying manager + state', () => {
    const host = new FakeScheduler();
    const ctl = installUndoRedo(host);
    expect(ctl.manager).toBeDefined();
    expect(ctl.state()).toMatchObject({ canUndo: false, canRedo: false });
    ctl.transact('move', () => host.events.update('a', { startDate: T0 + HOUR }));
    expect(ctl.state().canUndo).toBe(true);
    ctl.destroy();
    host.cleanup();
  });

  it('auto-disposes when the host emits destroy', () => {
    const host = new FakeScheduler();
    const ctl = installUndoRedo(host);
    host.fireDestroy();
    // After host destroy the update wrapper is removed → no capture.
    host.events.update('a', { startDate: T0 + HOUR * 3 });
    expect(ctl.canUndo).toBe(false);
    host.cleanup();
  });

  it('destroy() removes the key listener and is idempotent', () => {
    const host = new FakeScheduler();
    const ctl = new UndoRedoController(host);
    ctl.transact('move', () => host.events.update('a', { startDate: T0 + HOUR }));
    ctl.destroy();
    ctl.destroy(); // idempotent

    const before = host.events.getById('a')!.startDate;
    key(host, 'z'); // listener gone → no effect
    expect(host.events.getById('a')!.startDate).toBe(before);
    host.cleanup();
  });

  it('disable() stops capture, enable() resumes', () => {
    const host = new FakeScheduler();
    const ctl = installUndoRedo(host);
    ctl.disable();
    host.events.update('a', { startDate: T0 + HOUR });
    expect(ctl.canUndo).toBe(false);
    ctl.enable();
    ctl.transact('move', () => host.events.update('a', { startDate: T0 + HOUR * 2 }));
    expect(ctl.canUndo).toBe(true);
    ctl.destroy();
    host.cleanup();
  });
});
