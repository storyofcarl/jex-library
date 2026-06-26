/**
 * Visual/interaction SMOKE test for the Gantt **split / segmented tasks** feature
 * in REAL Chromium. Run with `pnpm --filter @jects/gantt test:browser`.
 *
 * The headless engine fix this guards: a successor of a SPLIT predecessor must
 * anchor on the predecessor's gap-INCLUSIVE finish — it may NOT slide back into
 * the interruption. That correctness only *shows up on screen* once real layout
 * turns the scheduled spans into bar geometry, so we assert it in Chromium:
 *
 *   1. A split task paints one sub-bar per segment with a connector across the gap.
 *   2. An FS successor's bar starts at/after the RIGHT edge of the predecessor's
 *      LAST sub-bar (its true finish) — never over the gap connector.
 *   3. axe-core finds zero serious/critical violations with the feature mounted.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from './gantt.js';
import { GanttSegmentedTasksFeature } from './segmented-tasks.js';
import { readSegments } from '../engine/segments.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { TaskModel, DependencyModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5); // a Monday

/** Predecessor `p` is split (2d work, 2d gap, 2d work → 6d hull); `s` follows FS. */
function plan(): { tasks: TaskModel[]; dependencies: DependencyModel[] } {
  return {
    tasks: [
      {
        id: 'p',
        name: 'Pour + cure',
        start: T0,
        end: T0 + 6 * DAY,
        duration: 4 * DAY,
        segments: [
          { start: T0, end: T0 + 2 * DAY },
          { start: T0 + 4 * DAY, end: T0 + 6 * DAY },
        ],
      } as TaskModel,
      { id: 's', name: 'Frame', duration: 2 * DAY } as TaskModel,
    ],
    dependencies: [{ id: 'l', fromId: 'p', toId: 's', type: 'FS' } as DependencyModel],
  };
}

let host: HTMLElement;
let gantt: Gantt | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.height = '320px';
  host.style.width = '1200px';
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

describe('GanttSegmentedTasksFeature — split dependency propagation (real Chromium)', () => {
  it('paints one sub-bar per segment with a gap connector', () => {
    const { tasks, dependencies } = plan();
    gantt = new Gantt(host, { tasks, dependencies, projectStart: T0 });
    const feature = new GanttSegmentedTasksFeature();
    gantt.use(feature);
    feature.paint();

    const bar = gantt.el.querySelector('.jects-gantt__bar[data-task-id="p"]') as HTMLElement;
    expect(bar.dataset.split).toBe('2');
    const overlay = bar.querySelector('.jects-gantt__segments') as HTMLElement;
    const subBars = overlay.querySelectorAll('.jects-gantt__segment');
    const connectors = overlay.querySelectorAll('.jects-gantt__segment-connector');
    expect(subBars).toHaveLength(2);
    expect(connectors).toHaveLength(1);

    // Each sub-bar has real, non-zero rendered size and they are ordered L→R.
    const r0 = (subBars[0] as HTMLElement).getBoundingClientRect();
    const r1 = (subBars[1] as HTMLElement).getBoundingClientRect();
    expect(r0.width).toBeGreaterThan(0);
    expect(r1.width).toBeGreaterThan(0);
    expect(r1.left).toBeGreaterThan(r0.right - 1);
  });

  it('the FS successor bar starts at/after the split predecessor’s true finish', () => {
    const { tasks, dependencies } = plan();
    gantt = new Gantt(host, { tasks, dependencies, projectStart: T0 });
    const feature = new GanttSegmentedTasksFeature();
    gantt.use(feature);
    feature.paint();

    // Engine truth: s.start == p's gap-inclusive end (last segment end).
    const p = gantt.getTask('p') as TaskModel;
    const s = gantt.getTask('s') as TaskModel;
    const segs = readSegments(p);
    expect(p.end).toBe(segs[segs.length - 1]!.end);
    expect(s.start).toBe(p.end);

    // Visual truth (rendered geometry): bars carry their horizontal placement as
    // inline `left`/`width` px (the renderer's source-of-truth in this harness).
    // The successor's LEFT edge must land at/after the predecessor's RIGHT edge —
    // i.e. it does NOT slide back over the interruption.
    const predBar = gantt.el.querySelector('.jects-gantt__bar[data-task-id="p"]') as HTMLElement;
    const succBar = gantt.el.querySelector('.jects-gantt__bar[data-task-id="s"]') as HTMLElement;
    const predLeft = parseFloat(predBar.style.left);
    const predWidth = parseFloat(predBar.style.width);
    const succLeft = parseFloat(succBar.style.left);
    expect(predWidth).toBeGreaterThan(0);
    expect(succLeft).toBeGreaterThanOrEqual(predLeft + predWidth - 1); // 1px tolerance

    // And within the predecessor bar the LAST sub-bar (true finish) reaches the
    // bar's right edge, while the connector (the visible interruption) sits to its
    // left — so the successor begins past the gap, not over it.
    const subBars = predBar.querySelectorAll('.jects-gantt__segment');
    const lastSub = subBars[subBars.length - 1] as HTMLElement;
    const connector = predBar.querySelector('.jects-gantt__segment-connector') as HTMLElement;
    const barRect = predBar.getBoundingClientRect();
    const lastSubRect = lastSub.getBoundingClientRect();
    const connRect = connector.getBoundingClientRect();
    // Sub-bar/connector geometry IS laid out relative to the bar, so rects are real.
    expect(lastSubRect.right).toBeGreaterThanOrEqual(barRect.right - 2);
    expect(connRect.right).toBeLessThanOrEqual(lastSubRect.left + 1);
  });

  it('mounts with no serious/critical a11y violations', async () => {
    const { tasks, dependencies } = plan();
    gantt = new Gantt(host, { tasks, dependencies, projectStart: T0 });
    const feature = new GanttSegmentedTasksFeature();
    gantt.use(feature);
    feature.paint();
    await expectNoA11yViolations(host);
  });
});
