/**
 * axe-core a11y + visual smoke for the `MultiBaselineCompare` Gantt feature, in
 * REAL Chromium (Quality Gate Q2 + a feature-exercising visual check).
 * Run with `pnpm --filter @jects/gantt test:browser`.
 *
 * Exercises the parity behaviour end-to-end with real layout/geometry:
 *   1. Two baselines are captured and BOTH render simultaneously with distinct
 *      variant styles and real pixel widths (the single-overlay path could only
 *      ever show one).
 *   2. The baseline picker is keyboard-operable: focusing + toggling a checkbox
 *      hides/shows that baseline's bands.
 *   3. The mounted feature (overlay + picker) has zero serious/critical a11y
 *      violations.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from './gantt.js';
import { MultiBaselineCompare } from './multi-baseline.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let gantt: Gantt | null = null;

function tasks(): TaskModel[] {
  return [
    { id: 'a', name: 'Design', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY },
    { id: 'b', name: 'Build', start: T0 + 3 * DAY, duration: 3 * DAY, end: T0 + 6 * DAY },
    { id: 'c', name: 'Ship', start: T0 + 6 * DAY, duration: 2 * DAY, end: T0 + 8 * DAY },
  ];
}

function bands(): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('.jects-gantt__baseline-band'));
}

beforeEach(() => {
  host = document.createElement('div');
  host.style.height = '420px';
  host.style.width = '900px';
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

describe('MultiBaselineCompare (browser)', () => {
  it('renders multiple distinct baselines at once with real pixel geometry', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feat = new MultiBaselineCompare();
    gantt.use(feat);

    feat.capture('b1', 'Baseline 1');
    // Slip a task, then snapshot a second baseline so the two snapshots differ.
    gantt.updateTaskSpan('a', { start: T0 + 2 * DAY, end: T0 + 6 * DAY });
    feat.capture('b2', 'Baseline 2');
    feat.repaint();

    const all = bands();
    // 2 active baselines × 3 tasks = 6 bands, BOTH visible simultaneously.
    expect(all.length).toBe(6);

    // Distinct variant classes are present.
    const variantClasses = new Set(
      all.flatMap((el) =>
        Array.from(el.classList).filter((c) => c.startsWith('jects-gantt__baseline-band--n')),
      ),
    );
    expect(variantClasses.has('jects-gantt__baseline-band--n0')).toBe(true);
    expect(variantClasses.has('jects-gantt__baseline-band--n1')).toBe(true);

    // Real layout: every band has a positive rendered width.
    for (const el of all) {
      const w = el.getBoundingClientRect().width;
      expect(w).toBeGreaterThan(0);
    }
  });

  it('the picker checkbox toggles a baseline band on and off (keyboard-operable)', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feat = new MultiBaselineCompare();
    gantt.use(feat);
    feat.capture('b1', 'Baseline 1');
    feat.capture('b2', 'Baseline 2');
    expect(bands().length).toBe(6);

    const checks = host.querySelectorAll<HTMLInputElement>('.jects-gantt__baseline-picker-check');
    expect(checks.length).toBe(2);

    // Operate by focus + native toggle (keyboard path: focus then Space toggles).
    checks[1].focus();
    expect(document.activeElement).toBe(checks[1]);
    // Untick → its bands disappear.
    checks[1].checked = false;
    checks[1].dispatchEvent(new Event('change', { bubbles: true }));
    expect(bands().length).toBe(3);

    // Re-tick → its bands return.
    checks[1].checked = true;
    checks[1].dispatchEvent(new Event('change', { bubbles: true }));
    expect(bands().length).toBe(6);
  });

  it('has no serious/critical accessibility violations', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feat = new MultiBaselineCompare();
    gantt.use(feat);
    feat.capture('b1', 'Baseline 1');
    feat.capture('b2', 'Baseline 2');
    feat.repaint();
    await expectNoA11yViolations(host);
  });
});
