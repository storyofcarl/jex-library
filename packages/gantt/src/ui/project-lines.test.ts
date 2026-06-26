/**
 * jsdom unit tests for the ProjectLines feature + the Gantt print path.
 *
 * Covers:
 *   - pure resolution of symbolic anchors (projectStart/projectEnd) + absolute
 *     dates, and out-of-range culling on projection,
 *   - the `ProjectLines` renderer: one rule per visible marker, kind modifiers,
 *     labels, click routing, repaint on span/line changes, and leak-free destroy,
 *   - `GanttPrintController`: print-stylesheet injection + isolation markers +
 *     restoration, with a headless `skipDialog` path and a real `window.print`
 *     stub driving the `afterprint` restore.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DefaultTimeAxis, WEEK_AND_DAY } from '@jects/timeline-core';
import {
  ProjectLines,
  GanttPrintController,
  resolveProjectLines,
  projectProjectLines,
  type ProjectLine,
} from './project-lines.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);
const range = { start: T0 - 7 * DAY, end: T0 + 30 * DAY };
const projectSpan = { start: T0, end: T0 + 20 * DAY };

function axisOf() {
  return new DefaultTimeAxis({ range, preset: WEEK_AND_DAY, zoom: 1 });
}

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

describe('resolveProjectLines', () => {
  it('resolves symbolic anchors against the project span', () => {
    const lines: ProjectLine[] = [
      { id: 'ps', anchor: 'projectStart', kind: 'start' },
      { id: 'pe', anchor: 'projectEnd', kind: 'end' },
    ];
    const resolved = resolveProjectLines(lines, projectSpan);
    expect(resolved.map((l) => l.date)).toEqual([projectSpan.start, projectSpan.end]);
  });

  it('prefers an absolute date over an anchor and drops un-anchorable lines', () => {
    const lines: ProjectLine[] = [
      { id: 'abs', date: T0 + 5 * DAY, anchor: 'projectEnd' },
      { id: 'noanchor', anchor: 'projectStart' }, // no span → dropped
      { id: 'nothing' }, // neither date nor anchor → dropped
    ];
    const resolved = resolveProjectLines(lines, undefined);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.id).toBe('abs');
    expect(resolved[0]!.date).toBe(T0 + 5 * DAY);
  });
});

describe('projectProjectLines', () => {
  it('projects in-range lines to a pixel x and culls out-of-range ones', () => {
    const axis = axisOf();
    const boxes = projectProjectLines(
      [
        { id: 'in', date: T0 + 2 * DAY },
        { id: 'before', date: range.start - DAY },
        { id: 'after', date: range.end + DAY },
      ],
      axis,
    );
    expect(boxes.map((b) => b.line.id)).toEqual(['in']);
    expect(boxes[0]!.x).toBeCloseTo(axis.toX(T0 + 2 * DAY), 5);
  });
});

describe('ProjectLines renderer', () => {
  let lines: ProjectLines | null = null;
  afterEach(() => {
    lines?.destroy();
    lines = null;
  });

  it('renders one rule per visible marker with kind modifiers + labels', () => {
    lines = new ProjectLines({
      axis: axisOf(),
      projectSpan,
      lines: [
        { id: 'ps', anchor: 'projectStart', kind: 'start', label: 'Kickoff' },
        { id: 'dl', date: T0 + 10 * DAY, kind: 'deadline', label: 'Beta' },
        { id: 'off', date: range.end + 5 * DAY, kind: 'custom' }, // out of range
      ],
    });
    host.append(lines.el);
    lines.setHeight(200);

    const els = lines.el.querySelectorAll('.jects-gantt__project-line');
    expect(els.length).toBe(2);
    expect(lines.el.querySelector('.jects-gantt__project-line--start')).not.toBeNull();
    expect(lines.el.querySelector('.jects-gantt__project-line--deadline')).not.toBeNull();
    // Labels rendered with text.
    const labels = [...lines.el.querySelectorAll('.jects-gantt__project-line-label')].map(
      (l) => l.textContent,
    );
    expect(labels).toContain('Kickoff');
    expect(labels).toContain('Beta');
    // Full content height applied so rules span the scroll content.
    expect(lines.el.style.height).toBe('200px');
  });

  it('positions a line at the axis projection of its date', () => {
    const axis = axisOf();
    lines = new ProjectLines({ axis, lines: [{ id: 'd', date: T0 + 3 * DAY }] });
    host.append(lines.el);
    const el = lines.el.querySelector('.jects-gantt__project-line') as HTMLElement;
    expect(el.style.left).toBe(`${axis.toX(T0 + 3 * DAY)}px`);
  });

  it('repaints when the project span moves a symbolic anchor', () => {
    const axis = axisOf();
    lines = new ProjectLines({
      axis,
      projectSpan,
      lines: [{ id: 'pe', anchor: 'projectEnd', kind: 'end' }],
    });
    host.append(lines.el);
    const before = (lines.el.querySelector('.jects-gantt__project-line') as HTMLElement).style.left;
    lines.setProjectSpan({ start: T0, end: T0 + 25 * DAY });
    const after = (lines.el.querySelector('.jects-gantt__project-line') as HTMLElement).style.left;
    expect(after).not.toBe(before);
    expect(after).toBe(`${axis.toX(T0 + 25 * DAY)}px`);
  });

  it('routes a click on a marker to onLineClick with its id', () => {
    let clicked: string | null = null;
    lines = new ProjectLines({
      axis: axisOf(),
      lines: [{ id: 'dl', date: T0 + 4 * DAY, kind: 'deadline', label: 'Ship' }],
      onLineClick: (id) => {
        clicked = id;
      },
    });
    host.append(lines.el);
    const el = lines.el.querySelector('.jects-gantt__project-line') as HTMLElement;
    expect(el.classList.contains('jects-gantt__project-line--interactive')).toBe(true);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicked).toBe('dl');
  });

  it('exposes an interactive marker to AT as a focusable button (role + tabindex)', () => {
    lines = new ProjectLines({
      axis: axisOf(),
      lines: [{ id: 'dl', date: T0 + 4 * DAY, kind: 'deadline', label: 'Ship' }],
      onLineClick: () => {},
    });
    host.append(lines.el);
    const el = lines.el.querySelector('.jects-gantt__project-line') as HTMLElement;
    // WCAG 4.1.2: an actionable control must announce as a button, not a list item.
    expect(el.getAttribute('role')).toBe('button');
    // WCAG 2.1.1: it must be reachable by keyboard.
    expect(el.tabIndex).toBe(0);
    expect(el.getAttribute('aria-label')).toBe('Ship marker');
  });

  it('activates an interactive marker via the keyboard (Enter and Space)', () => {
    const keys: string[] = [];
    lines = new ProjectLines({
      axis: axisOf(),
      lines: [{ id: 'dl', date: T0 + 4 * DAY, kind: 'deadline', label: 'Ship' }],
      onLineClick: (id) => {
        keys.push(id);
      },
    });
    host.append(lines.el);
    const el = lines.el.querySelector('.jects-gantt__project-line') as HTMLElement;

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    el.dispatchEvent(enter);
    expect(keys).toEqual(['dl']);
    expect(enter.defaultPrevented).toBe(true);

    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    el.dispatchEvent(space);
    expect(keys).toEqual(['dl', 'dl']);
    // Space must not scroll the page.
    expect(space.defaultPrevented).toBe(true);

    // An unrelated key is ignored.
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(keys).toHaveLength(2);
  });

  it('keeps non-interactive markers presentational (role=listitem, not focusable)', () => {
    lines = new ProjectLines({
      axis: axisOf(),
      lines: [{ id: 'ps', date: T0, kind: 'start' }],
      // no onLineClick → not interactive
    });
    host.append(lines.el);
    const el = lines.el.querySelector('.jects-gantt__project-line') as HTMLElement;
    expect(el.getAttribute('role')).toBe('listitem');
    expect(el.tabIndex).toBe(-1);
    expect(el.classList.contains('jects-gantt__project-line--interactive')).toBe(false);
  });

  it('exposes an accessible name on each rule and a list role on the layer', () => {
    lines = new ProjectLines({
      axis: axisOf(),
      lines: [{ id: 'ps', date: T0, kind: 'start' }],
    });
    host.append(lines.el);
    expect(lines.el.getAttribute('role')).toBe('list');
    const el = lines.el.querySelector('.jects-gantt__project-line') as HTMLElement;
    expect(el.getAttribute('role')).toBe('listitem');
    // Default label fills in when none was supplied.
    expect(el.getAttribute('aria-label')).toBe('Project start marker');
  });

  it('updates via setLines and removes its element + listener on destroy', () => {
    lines = new ProjectLines({ axis: axisOf(), lines: [{ id: 'a', date: T0 }] });
    host.append(lines.el);
    expect(lines.el.querySelectorAll('.jects-gantt__project-line').length).toBe(1);
    lines.setLines([
      { id: 'a', date: T0 },
      { id: 'b', date: T0 + DAY },
    ]);
    expect(lines.el.querySelectorAll('.jects-gantt__project-line').length).toBe(2);
    lines.destroy();
    expect(lines.el.isConnected).toBe(false);
    // Idempotent.
    expect(() => lines!.destroy()).not.toThrow();
  });
});

describe('GanttPrintController', () => {
  let ctrl: GanttPrintController | null = null;
  afterEach(() => {
    ctrl?.destroy();
    ctrl = null;
  });

  it('injects a scoped print stylesheet + marks the target, then restores (skipDialog)', async () => {
    const root = document.createElement('div');
    root.className = 'jects-gantt';
    host.append(root);
    ctrl = new GanttPrintController(root);
    ctrl.print({ skipDialog: true, title: 'Plan' });

    // Synchronously during print: stylesheet present, target marked, title swapped.
    const style = document.getElementById('jects-gantt-print-style') as HTMLStyleElement;
    expect(style).not.toBeNull();
    expect(style.media).toBe('print');
    expect(style.textContent).toContain('@page');
    expect(style.textContent).toContain('visibility: hidden');
    expect(root.hasAttribute('data-jects-print-root')).toBe(true);
    expect(ctrl.isPrinting).toBe(true);
    expect(document.title).toBe('Plan');

    // The restore runs on the next microtask.
    await Promise.resolve();
    expect(document.getElementById('jects-gantt-print-style')).toBeNull();
    expect(root.hasAttribute('data-jects-print-root')).toBe(false);
    expect(ctrl.isPrinting).toBe(false);
  });

  it('emits a landscape @page by default and respects an orientation override', () => {
    const root = document.createElement('div');
    host.append(root);
    ctrl = new GanttPrintController(root);
    ctrl.print({ skipDialog: true });
    expect(document.getElementById('jects-gantt-print-style')!.textContent).toContain(
      'size: landscape',
    );
    ctrl.destroy();

    ctrl = new GanttPrintController(root);
    ctrl.print({ skipDialog: true, orientation: 'portrait' });
    expect(document.getElementById('jects-gantt-print-style')!.textContent).toContain(
      'size: portrait',
    );
  });

  it('calls window.print and restores on the afterprint event', () => {
    const root = document.createElement('div');
    host.append(root);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    ctrl = new GanttPrintController(root);
    ctrl.print();

    expect(printSpy).toHaveBeenCalledTimes(1);
    // While the dialog is "open" the scaffolding stays.
    expect(document.getElementById('jects-gantt-print-style')).not.toBeNull();
    expect(root.hasAttribute('data-jects-print-root')).toBe(true);

    // Browser fires afterprint when the dialog closes → restore.
    window.dispatchEvent(new Event('afterprint'));
    expect(document.getElementById('jects-gantt-print-style')).toBeNull();
    expect(root.hasAttribute('data-jects-print-root')).toBe(false);
    printSpy.mockRestore();
  });

  it('destroy() removes any injected style + lingering markers', () => {
    const root = document.createElement('div');
    host.append(root);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    ctrl = new GanttPrintController(root);
    ctrl.print(); // leaves scaffolding (no afterprint fired)
    expect(document.getElementById('jects-gantt-print-style')).not.toBeNull();
    ctrl.destroy();
    expect(document.getElementById('jects-gantt-print-style')).toBeNull();
    expect(root.hasAttribute('data-jects-print-root')).toBe(false);
    printSpy.mockRestore();
  });
});
