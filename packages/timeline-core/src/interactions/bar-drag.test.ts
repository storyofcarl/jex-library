/** jsdom unit tests for drag / resize / drag-create primitives. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  startBarDrag,
  startDragCreate,
  type DragState,
  type DragCreateState,
} from './bar-drag.js';
import { TestAxis, makePointer, makeCaptureEl } from './test-harness.js';

// 0.01 px/ms, 1000ms snap → 10px == 1000ms.
const axis = new TestAxis(0.01, 1000, 0);

let target: HTMLElement;
beforeEach(() => {
  target = makeCaptureEl();
  document.body.appendChild(target);
});
afterEach(() => {
  target.remove();
});

function dispatch(type: string, clientX: number): void {
  window.dispatchEvent(makePointer(type, clientX));
}

describe('startBarDrag: move', () => {
  it('shifts the span by the snapped pixel delta, preserving duration', () => {
    const previews: DragState[] = [];
    let committed: DragState | undefined;
    const c = startBarDrag(makePointer('pointerdown', 0, { target }), {
      eventId: 'e1',
      mode: 'move',
      origin: { start: 1000, end: 3000 },
      axis,
      onPreview: (s) => previews.push(s),
      onCommit: (s) => (committed = s),
    });
    expect(c.isActive).toBe(true);

    // Move +25px → +2500ms, snapped to +2000 (start 1000→3000? actually
    // start+2500=3500 snaps to 4000). Verify via final commit.
    dispatch('pointermove', 25);
    expect(previews.length).toBe(1);
    dispatch('pointerup', 25);

    expect(committed).toBeDefined();
    // origin.start 1000 + 2500 = 3500 → snap to 4000; duration 2000 preserved.
    expect(committed!.span).toEqual({ start: 4000, end: 6000 });
    expect(c.isActive).toBe(false);
  });

  it('does not commit when the span is unchanged', () => {
    let committed = false;
    let ended = false;
    startBarDrag(makePointer('pointerdown', 0, { target }), {
      eventId: 'e1',
      mode: 'move',
      origin: { start: 1000, end: 3000 },
      axis,
      onCommit: () => (committed = true),
      onEnd: () => (ended = true),
    });
    dispatch('pointermove', 0);
    dispatch('pointerup', 0);
    expect(committed).toBe(false);
    expect(ended).toBe(true);
  });
});

describe('startBarDrag: resize', () => {
  it('resize-end extends the end, snapped, holding the start', () => {
    let committed: DragState | undefined;
    startBarDrag(makePointer('pointerdown', 30, { target }), {
      eventId: 'e1',
      mode: 'resize-end',
      origin: { start: 1000, end: 3000 }, // end at x=30
      axis,
      onCommit: (s) => (committed = s),
    });
    dispatch('pointermove', 52); // +22px → +2200ms → end 5200 snap 5000
    dispatch('pointerup', 52);
    expect(committed!.span).toEqual({ start: 1000, end: 5000 });
  });

  it('resize-start cannot cross end minus the min duration', () => {
    let committed: DragState | undefined;
    startBarDrag(makePointer('pointerdown', 10, { target }), {
      eventId: 'e1',
      mode: 'resize-start',
      origin: { start: 1000, end: 3000 },
      axis,
      minDuration: 1000,
      onCommit: (s) => (committed = s),
    });
    // Drag start way past the end.
    dispatch('pointermove', 200);
    dispatch('pointerup', 200);
    expect(committed!.span.start).toBeLessThanOrEqual(3000 - 1000);
    expect(committed!.span.end).toBe(3000);
  });

  it('respects hard bounds', () => {
    let committed: DragState | undefined;
    startBarDrag(makePointer('pointerdown', 30, { target }), {
      eventId: 'e1',
      mode: 'resize-end',
      origin: { start: 1000, end: 3000 },
      axis,
      bounds: { start: 0, end: 4000 },
      onCommit: (s) => (committed = s),
    });
    dispatch('pointermove', 100); // would extend far past 4000
    dispatch('pointerup', 100);
    expect(committed!.span.end).toBe(4000);
  });
});

describe('startBarDrag: veto + cancel', () => {
  it('onBefore returning false aborts the gesture', () => {
    let preview = false;
    const c = startBarDrag(makePointer('pointerdown', 0, { target }), {
      eventId: 'e1',
      mode: 'move',
      origin: { start: 1000, end: 3000 },
      axis,
      onBefore: () => false,
      onPreview: () => (preview = true),
    });
    expect(c.isActive).toBe(false);
    dispatch('pointermove', 50);
    expect(preview).toBe(false);
  });

  it('cancel() restores the origin and fires onEnd once', () => {
    let endCount = 0;
    const c = startBarDrag(makePointer('pointerdown', 0, { target }), {
      eventId: 'e1',
      mode: 'move',
      origin: { start: 1000, end: 3000 },
      axis,
      onEnd: () => endCount++,
    });
    dispatch('pointermove', 50);
    c.cancel();
    c.cancel();
    expect(c.span).toEqual({ start: 1000, end: 3000 });
    expect(endCount).toBe(1);
  });

  it('pointercancel aborts the gesture', () => {
    const c = startBarDrag(makePointer('pointerdown', 0, { target }), {
      eventId: 'e1',
      mode: 'move',
      origin: { start: 1000, end: 3000 },
      axis,
    });
    window.dispatchEvent(makePointer('pointercancel', 0));
    expect(c.isActive).toBe(false);
  });

  it('removes global listeners after finishing (no leak on later moves)', () => {
    const previews: DragState[] = [];
    startBarDrag(makePointer('pointerdown', 0, { target }), {
      eventId: 'e1',
      mode: 'move',
      origin: { start: 1000, end: 3000 },
      axis,
      onPreview: (s) => previews.push(s),
    });
    dispatch('pointerup', 30);
    const after = previews.length;
    dispatch('pointermove', 90);
    expect(previews.length).toBe(after);
  });
});

describe('startDragCreate', () => {
  function contentX(clientX: number): number {
    return clientX; // identity in tests
  }

  it('sweeps an ordered span and commits when over the min duration', () => {
    let committed: DragCreateState | undefined;
    const c = startDragCreate(makePointer('pointerdown', 10, { target }), {
      rowId: 'r1',
      anchorTime: axis.toTime(10), // 1000
      axis,
      toContentX: contentX,
      minDuration: 1000,
      onCommit: (s) => (committed = s),
    });
    expect(c.isActive).toBe(true);
    dispatch('pointermove', 35); // 3500 → snap 4000
    dispatch('pointerup', 35);
    expect(committed!.span).toEqual({ start: 1000, end: 4000 });
  });

  it('sweeping backwards still produces an ordered span', () => {
    let committed: DragCreateState | undefined;
    startDragCreate(makePointer('pointerdown', 40, { target }), {
      rowId: 'r1',
      anchorTime: axis.toTime(40), // 4000
      axis,
      toContentX: contentX,
      minDuration: 500,
      onCommit: (s) => (committed = s),
    });
    dispatch('pointermove', 12); // 1200 → snap 1000
    dispatch('pointerup', 12);
    expect(committed!.span).toEqual({ start: 1000, end: 4000 });
  });

  it('does not commit a zero-width sweep', () => {
    let committed = false;
    let ended = false;
    startDragCreate(makePointer('pointerdown', 10, { target }), {
      rowId: 'r1',
      anchorTime: axis.toTime(10),
      axis,
      toContentX: contentX,
      minDuration: 1000,
      onCommit: () => (committed = true),
      onEnd: () => (ended = true),
    });
    dispatch('pointerup', 10);
    expect(committed).toBe(false);
    expect(ended).toBe(true);
  });

  it('onBefore veto aborts the sweep', () => {
    const c = startDragCreate(makePointer('pointerdown', 10, { target }), {
      rowId: 'r1',
      anchorTime: axis.toTime(10),
      axis,
      toContentX: contentX,
      onBefore: () => false,
    });
    expect(c.isActive).toBe(false);
  });
});
