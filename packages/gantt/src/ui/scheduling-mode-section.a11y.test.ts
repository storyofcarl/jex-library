/**
 * axe-core a11y + visual/interaction smoke for the Advanced scheduling-mode
 * section (and the default today line), in REAL Chromium (Quality Gate Q2 + a
 * feature-exercising visual check). Run with
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations, this exercises the feature end to
 * end with real layout/geometry + a real `ProjectLines` render:
 *   1. The section renders the mode radiogroup + constraint select + (opt-in)
 *      effort controls with real pixel size and an associated accessible name.
 *   2. Switching the constraint to a dated type reveals the constraint-date row
 *      (real visibility), and the chosen date appears in the typed patch.
 *   3. Choosing "Manually scheduled" disables the direction/constraint controls
 *      (a pinned bar ignores them) and flips the patch.
 *   4. The default today line paints onto a real `ProjectLines` layer at its
 *      projected x with the today kind.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the real package stylesheet so geometry assertions exercise the shipped,
// token-pure CSS rather than unstyled defaults.
import '../styles.css';
import './scheduling-mode-section.css';
import { DefaultTimeAxis, WEEK_AND_DAY } from '@jects/timeline-core';
import {
  SchedulingModeSection,
  defaultTodayLine,
  defaultProjectLines,
} from './scheduling-mode-section.js';
import { ProjectLines } from './project-lines.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { TaskModel } from '../contract.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let section: SchedulingModeSection | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.padding = '16px';
  host.style.width = '420px';
  document.body.appendChild(host);
});

afterEach(() => {
  section?.destroy();
  section = null;
  host.remove();
});

function task(over: Partial<TaskModel> = {}): TaskModel {
  return { id: 't1', name: 'Design', start: T0, end: T0 + 3 * DAY, duration: 3 * DAY, ...over };
}

describe('SchedulingModeSection (browser a11y + visual)', () => {
  it('renders the section with real geometry + no serious/critical violations', async () => {
    section = new SchedulingModeSection({
      task: task({ effort: 24 * HOUR, effortDriven: true } as Partial<TaskModel>),
      effortEnabled: true,
      hoursPerDay: 8,
    });
    host.append(section.el);

    const rect = section.el.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);

    // The group is named, the radiogroup has two named radios, the constraint
    // select + effort controls are present and labelled.
    expect(section.el.getAttribute('role')).toBe('group');
    expect(section.el.querySelectorAll('[role="radiogroup"] input[type="radio"]').length).toBe(2);
    expect(section.el.querySelector('select')).not.toBeNull();
    expect(section.el.querySelector('input[type="number"]')).not.toBeNull();
    expect(section.el.querySelector('input[type="checkbox"]')).not.toBeNull();

    await expectNoA11yViolations(host);
  });

  it('reveals the constraint-date row for a dated constraint (real visibility)', async () => {
    section = new SchedulingModeSection({ task: task() });
    host.append(section.el);

    const dateInput = section.el.querySelector<HTMLInputElement>('input[type="date"]')!;
    // Hidden initially (ASAP is dateless) → zero layout box.
    expect(dateInput.getClientRects().length).toBe(0);

    const sel = section.el.querySelector<HTMLSelectElement>('select')!;
    sel.value = 'mustStartOn';
    sel.dispatchEvent(new Event('change'));

    // Now visible with a real box, and the chosen date flows into the patch.
    expect(dateInput.getClientRects().length).toBeGreaterThan(0);
    dateInput.value = '2026-01-09';
    dateInput.dispatchEvent(new Event('change'));
    expect(section.getPatch().constraintDate).toBe(Date.UTC(2026, 0, 9));

    await expectNoA11yViolations(host);
  });

  it('disables direction/constraint controls when Manually scheduled (keyboard)', async () => {
    section = new SchedulingModeSection({ task: task() });
    host.append(section.el);

    const sel = section.el.querySelector<HTMLSelectElement>('select')!;
    const [auto, manual] = section.el.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(sel.disabled).toBe(false);

    // Keyboard: focus the manual radio + activate via click (radio semantics).
    manual!.focus();
    expect(document.activeElement).toBe(manual);
    manual!.click();

    expect(section.mode).toBe('manual');
    expect(sel.disabled).toBe(true);
    expect(section.getPatch().manuallyScheduled).toBe(true);

    // Back to auto re-enables.
    auto!.click();
    expect(sel.disabled).toBe(false);

    await expectNoA11yViolations(host);
  });
});

describe('default today line on a real ProjectLines layer (browser)', () => {
  let lines: ProjectLines | null = null;
  afterEach(() => {
    lines?.destroy();
    lines = null;
  });

  it('paints the default today/status line full-height at its projected x', async () => {
    const range = { start: T0 - 7 * DAY, end: T0 + 40 * DAY };
    const axis = new DefaultTimeAxis({ range, preset: WEEK_AND_DAY, zoom: 1 });
    const layerHost = document.createElement('div');
    layerHost.style.position = 'relative';
    layerHost.style.height = '300px';
    layerHost.style.width = '960px';
    host.append(layerHost);

    lines = new ProjectLines({
      axis,
      projectSpan: { start: T0, end: T0 + 30 * DAY },
      lines: defaultProjectLines({ now: T0 + 10 * DAY, projectBoundaries: true }),
    });
    layerHost.append(lines.el);
    lines.setHeight(280);

    const today = layerHost.querySelector('[data-line-id="today"]') as HTMLElement;
    expect(today).not.toBeNull();
    expect(today.classList.contains('jects-gantt__project-line--today')).toBe(true);
    const rect = today.getBoundingClientRect();
    expect(rect.height).toBeGreaterThan(250);
    expect(rect.width).toBeGreaterThan(0);

    // The today line sits to the right of project-start and left of project-end.
    const left = (id: string): number =>
      (layerHost.querySelector(`[data-line-id="${id}"]`) as HTMLElement).getBoundingClientRect()
        .left;
    expect(left('project-start')).toBeLessThan(left('today'));
    expect(left('today')).toBeLessThan(left('project-end'));

    await expectNoA11yViolations(layerHost);
  });

  it('builds a today line with the expected kind/label', () => {
    const line = defaultTodayLine({ now: T0 });
    expect(line.kind).toBe('today');
    expect(line.label).toBe('Today');
  });
});
