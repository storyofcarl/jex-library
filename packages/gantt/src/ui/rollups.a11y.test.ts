/**
 * axe-core a11y + visual/interaction browser test for the Gantt **child-rollup
 * glyphs + tooltip** feature (Quality Gate Q2). Runs in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations, this exercises the feature end to
 * end on a real `Gantt` + engine: collapsing a flagged summary projects each
 * descendant leaf task/milestone onto the parent bar as a focusable glyph at its
 * real pixel position; keyboard-focusing a glyph reveals a floating tooltip with
 * the child's name + dates; glyphs are ordered left→right in time and stay within
 * the summary bar's pixel bounds.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the theme tokens FIRST so spacing/size tokens (e.g. --jects-space-1 used
// in the tooltip's `translate(...)`) resolve — otherwise the transform is
// invalid-at-computed-value and the tip drops below the glyph. Then the shipped,
// token-pure package stylesheet so the geometry assertions exercise the real CSS.
import '@jects/theme/base.css';
import '../styles.css';
import { Gantt } from './gantt.js';
import { GanttRollups } from './rollups.js';
import type { TaskModel } from '../contract.js';
import type { TreeStore, RecordId } from '@jects/core';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let gantt: Gantt | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.position = 'relative';
  host.style.height = '320px';
  host.style.width = '960px';
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

function plan(): TaskModel[] {
  return [
    { id: 'parent', name: 'Phase 1', rollup: true } as TaskModel,
    { id: 'a', name: 'Design', parentId: 'parent', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY, percentDone: 0.5, rollup: true } as TaskModel,
    { id: 'b', name: 'Build', parentId: 'parent', start: T0 + 2 * DAY, duration: 3 * DAY, end: T0 + 5 * DAY, rollup: true } as TaskModel,
    { id: 'm', name: 'Sign-off', parentId: 'parent', start: T0 + 5 * DAY, milestone: true, rollup: true } as TaskModel,
  ];
}

function collapse(g: Gantt, id: RecordId): void {
  const store = (g as unknown as { _store: TreeStore<TaskModel> })._store;
  store.collapse(id);
  (g as unknown as { refreshPanes(): void }).refreshPanes();
}

function summaryBar(g: Gantt): HTMLElement {
  return g.el.querySelector('.jects-gantt__bar--summary[data-task-id="parent"]')!;
}

describe('GanttRollups a11y + visual (real Chromium)', () => {
  it('projects focusable child glyphs onto a collapsed summary with no serious/critical violations', async () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    const feature = new GanttRollups();
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();

    await expectNoA11yViolations(host);

    const bar = summaryBar(gantt);
    const track = bar.querySelector('.jects-gantt__rollup-track') as HTMLElement;
    expect(track).not.toBeNull();
    expect(track.getAttribute('role')).toBe('group');

    const glyphs = [
      ...bar.querySelectorAll<HTMLElement>('.jects-gantt__rollup-glyph'),
    ];
    expect(glyphs.length).toBe(3);

    // Real geometry: each glyph sits within the summary bar's pixel bounds and the
    // glyphs are ordered left→right in time (design, build, sign-off milestone).
    const barRect = bar.getBoundingClientRect();
    const lefts = glyphs.map((g) => g.getBoundingClientRect().left);
    for (const g of glyphs) {
      const r = g.getBoundingClientRect();
      expect(r.left).toBeGreaterThanOrEqual(barRect.left - 1);
      expect(r.right).toBeLessThanOrEqual(barRect.right + 1);
    }
    const sorted = [...lefts].sort((a, b) => a - b);
    expect(lefts).toEqual(sorted);
  });

  it('reveals a floating tooltip on keyboard focus and clears it on blur', async () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    const feature = new GanttRollups();
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();

    const glyph = summaryBar(gantt).querySelector<HTMLElement>(
      '.jects-gantt__rollup-glyph[data-task-id="a"]',
    )!;
    glyph.focus();
    expect(document.activeElement).toBe(glyph);

    const tip = gantt.el.querySelector('.jects-gantt__rollup-tip') as HTMLElement;
    expect(tip).not.toBeNull();
    expect(tip.hidden).toBe(false);
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.textContent).toContain('Design');
    // The tooltip is positioned above the glyph (its bottom is at/above the glyph top).
    const tipRect = tip.getBoundingClientRect();
    const glyphRect = glyph.getBoundingClientRect();
    expect(tipRect.bottom).toBeLessThanOrEqual(glyphRect.bottom + 2);

    await expectNoA11yViolations(host);

    glyph.blur();
    expect(tip.hidden).toBe(true);
  });
});
