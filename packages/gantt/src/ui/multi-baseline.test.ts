/**
 * jsdom unit tests for the `MultiBaselineCompare` Gantt feature.
 *
 * Verifies the parity behaviour the single-baseline path lacked: capturing and
 * overlaying MANY named baselines simultaneously, each with a distinct variant
 * style, a keyboard-operable picker that toggles individual bands on/off, per
 * baseline variance, and leak-free teardown (capture proxy restored, DOM gone).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from './gantt.js';
import {
  MultiBaselineCompare,
  createMultiBaselineCompare,
  MULTI_BASELINE_VARIANTS,
} from './multi-baseline.js';
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
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

describe('MultiBaselineCompare', () => {
  it('installs as a feature and mounts the overlay + picker', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feat = gantt.use(createMultiBaselineCompare());
    expect(gantt.features.get('multiBaselineCompare')).toBe(feat);
    expect(host.querySelector('.jects-gantt__baselines')).not.toBeNull();
    expect(host.querySelector('.jects-gantt__baseline-picker')).not.toBeNull();
  });

  it('the picker panel starts CLOSED and opens only on its trigger', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feat = gantt.use(createMultiBaselineCompare());
    const toggle = host.querySelector<HTMLButtonElement>(
      '.jects-gantt__baseline-picker-toggle',
    )!;
    const panel = host.querySelector<HTMLElement>('.jects-gantt__baseline-picker-panel')!;
    expect(toggle).not.toBeNull();
    expect(panel).not.toBeNull();

    // Closed by default: panel hidden, trigger collapsed.
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(feat.pickerOpened).toBe(false);

    // Opens on click.
    toggle.click();
    expect(panel.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(feat.pickerOpened).toBe(true);

    // Closes again on a second click.
    toggle.click();
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(feat.pickerOpened).toBe(false);
  });

  it('captures multiple named baselines and renders a distinct band per active one', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feat = new MultiBaselineCompare();
    gantt.use(feat);

    feat.capture('b1', 'Baseline 1');
    // No bands yet for a different schedule? They render off the current snapshot.
    const afterFirst = bands();
    expect(afterFirst.length).toBe(3); // 3 tasks, one band each

    // Slip a task, capture a second baseline.
    gantt.updateTask('a', { duration: 5 * DAY });
    feat.capture('b2', 'Baseline 2');

    const ids = feat.getActiveBaselineIds();
    expect(ids).toEqual(['b1', 'b2']);

    // Two active baselines → two bands per task = 6 total.
    const all = bands();
    expect(all.length).toBe(6);

    // The two baselines get DISTINCT variant modifiers.
    const variants = new Set(
      all.map(
        (el) =>
          Array.from(el.classList).find((c) => c.startsWith('jects-gantt__baseline-band--n')) ??
          '',
      ),
    );
    expect(variants.has('jects-gantt__baseline-band--n0')).toBe(true);
    expect(variants.has('jects-gantt__baseline-band--n1')).toBe(true);
  });

  it('exposes variance per baseline (live end − baseline end)', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feat = new MultiBaselineCompare();
    gantt.use(feat);
    feat.capture('b1', 'Baseline 1');

    expect(feat.variance('a', 'b1')).toBe(0);

    // Slip 'a' so its end moves +2 days vs the baseline snapshot.
    gantt.updateTaskSpan('a', { start: T0, end: T0 + 5 * DAY });
    expect(feat.variance('a', 'b1')).toBe(2 * DAY);
    expect(feat.variance('a', 'nope')).toBeUndefined();
    expect(feat.variance('zzz', 'b1')).toBeUndefined();
  });

  it('the picker toggles a baseline band on and off', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feat = new MultiBaselineCompare();
    gantt.use(feat);
    feat.capture('b1', 'Baseline 1');
    feat.capture('b2', 'Baseline 2');
    expect(bands().length).toBe(6);

    // Find the checkbox for b2 (second row) and uncheck it.
    const checks = host.querySelectorAll<HTMLInputElement>('.jects-gantt__baseline-picker-check');
    expect(checks.length).toBe(2);
    expect(checks[0].checked).toBe(true);
    checks[1].checked = false;
    checks[1].dispatchEvent(new Event('change'));

    // Only b1 active now → 3 bands.
    expect(bands().length).toBe(3);
    expect(feat.getActiveBaselineIds()).toEqual(['b1']);

    // Re-enable it.
    checks[1].checked = true;
    checks[1].dispatchEvent(new Event('change'));
    expect(bands().length).toBe(6);
  });

  it('the Capture button snapshots the current schedule into a new slot', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feat = new MultiBaselineCompare();
    gantt.use(feat);
    const btn = host.querySelector<HTMLButtonElement>('.jects-gantt__baseline-capture')!;
    expect(btn).not.toBeNull();

    btn.click();
    expect(feat.getBaselines().length).toBe(1);
    btn.click();
    expect(feat.getBaselines().length).toBe(2);
    expect(host.querySelectorAll('.jects-gantt__baseline-picker-row').length).toBe(2);
  });

  it('records baselines captured through the widget API too (capture proxy)', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feat = new MultiBaselineCompare();
    gantt.use(feat);

    // Capture via the WIDGET (not the feature) — the proxy should pick it up.
    gantt.captureBaseline('widget-cap', 'From widget');
    expect(feat.getBaselines().some((b) => b.id === 'widget-cap')).toBe(true);
  });

  it('seeds initialBaselines from config and respects active:false', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feat = createMultiBaselineCompare({
      initialBaselines: [
        { id: 'seed-1', name: 'Seed 1' },
        { id: 'seed-2', name: 'Seed 2', active: false },
      ],
    });
    gantt.use(feat);
    expect(feat.getBaselines().length).toBe(2);
    expect(feat.getActiveBaselineIds()).toEqual(['seed-1']);
    // 1 active baseline × 3 tasks = 3 bands.
    expect(bands().length).toBe(3);
  });

  it('caps auto-activation at the shipped variant budget', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feat = new MultiBaselineCompare();
    gantt.use(feat);
    for (let i = 0; i < MULTI_BASELINE_VARIANTS + 2; i++) {
      feat.capture(`b${i}`, `Baseline ${i}`);
    }
    expect(feat.getBaselines().length).toBe(MULTI_BASELINE_VARIANTS + 2);
    expect(feat.getActiveBaselineIds().length).toBe(MULTI_BASELINE_VARIANTS);
  });

  it('remove() forgets a baseline and drops its band + picker row', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feat = new MultiBaselineCompare();
    gantt.use(feat);
    feat.capture('b1', 'Baseline 1');
    feat.capture('b2', 'Baseline 2');
    feat.remove('b1');
    expect(feat.getBaselines().map((b) => b.id)).toEqual(['b2']);
    expect(bands().length).toBe(3);
    expect(host.querySelectorAll('.jects-gantt__baseline-picker-row').length).toBe(1);
  });

  it('repaints bands in lockstep after a reschedule moves a bar', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feat = new MultiBaselineCompare();
    gantt.use(feat);
    feat.capture('b1', 'Baseline 1');
    const bandA = host.querySelector<HTMLElement>(
      '.jects-gantt__baseline-band[data-task-id="a"]',
    )!;
    const leftBefore = bandA.style.left;
    // Push the task far later; baseline band stays put while variance grows.
    gantt.updateTaskSpan('a', { start: T0 + 10 * DAY, end: T0 + 13 * DAY });
    feat.repaint();
    const bandAfter = host.querySelector<HTMLElement>(
      '.jects-gantt__baseline-band[data-task-id="a"]',
    )!;
    // The baseline band reflects the ORIGINAL snapshot (unchanged left), and the
    // variance attribute now reflects the slip.
    expect(bandAfter.style.left).toBe(leftBefore);
    expect(Number(bandAfter.dataset.varianceMs)).toBeGreaterThan(0);
  });

  it('restores the original captureBaseline and removes its DOM on destroy', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const before = gantt.captureBaseline;
    const feat = new MultiBaselineCompare();
    gantt.use(feat);
    // Proxy installed → method reference changed.
    expect(gantt.captureBaseline).not.toBe(before);
    feat.capture('b1', 'Baseline 1');
    expect(bands().length).toBe(3);

    feat.destroy();
    expect(host.querySelector('.jects-gantt__baselines')).toBeNull();
    expect(host.querySelector('.jects-gantt__baseline-picker')).toBeNull();
    // Original capture restored.
    expect(gantt.captureBaseline).toBe(before);
  });

  // Regression: destroy() used `delete api.captureBaseline`, which only works
  // when the method is inherited from the prototype. If captureBaseline is an
  // OWN/instance property (constructor-assigned, or another feature already
  // wrapped it), `delete` removes it entirely (or reverts to a DIFFERENT
  // implementation), corrupting the method. The safe save-original/restore must
  // put the exact prior OWN value back.
  it('restores an OWN/instance captureBaseline exactly (does not delete it)', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });

    // Simulate another feature (or the constructor) having installed
    // captureBaseline as an OWN property that wraps the prototype method.
    const proto = gantt.captureBaseline.bind(gantt);
    let outerCalls = 0;
    const outerWrapper = (id: string, name?: string) => {
      outerCalls++;
      return proto(id, name);
    };
    (gantt as unknown as { captureBaseline: typeof outerWrapper }).captureBaseline = outerWrapper;
    expect(
      Object.prototype.hasOwnProperty.call(gantt, 'captureBaseline'),
    ).toBe(true);

    const feat = new MultiBaselineCompare();
    gantt.use(feat);
    // Proxy now shadows the outer wrapper.
    expect(gantt.captureBaseline).not.toBe(outerWrapper);

    feat.destroy();

    // The EXACT outer wrapper own-property is restored — not deleted, not the
    // raw prototype method.
    expect(gantt.captureBaseline).toBe(outerWrapper);
    expect(
      Object.prototype.hasOwnProperty.call(gantt, 'captureBaseline'),
    ).toBe(true);

    // And it still works (delegates to the wrapped prototype method).
    gantt.captureBaseline('after', 'After');
    expect(outerCalls).toBeGreaterThan(0);
  });
});
