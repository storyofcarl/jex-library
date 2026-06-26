/**
 * Real-browser (Chromium) a11y + visual/interaction test for the ICS
 * export/import feature.
 *
 * Mounts a live Scheduler plus the themed ICS toolbar, then:
 *  - asserts the toolbar renders with the correct toolbar role + accessible
 *    buttons (token-pure CSS, real layout);
 *  - runs axe-core for zero serious/critical violations;
 *  - exercises the round-trip end to end: serialize the store to ICS, clear it,
 *    re-import the ICS, and assert the events (including an RRULE master) land
 *    back on their lanes and repaint as real bars in the DOM.
 */
import { describe, it, afterEach, expect } from 'vitest';
import { WEEK_AND_DAY } from '@jects/timeline-core';
import '@jects/theme/style.css';
import '../styles.css';
import { Scheduler } from '../view/scheduler.js';
import { mountIcsToolbar, IcsExporter, IcsImporter } from './ics.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { ResourceModel, EventModel } from '../contract.js';

const DAY = 86_400_000;
const start = Date.UTC(2025, 0, 1);

let host: HTMLElement;
const cleanup: Array<{ dispose?(): void; destroy?(): void }> = [];

afterEach(() => {
  for (const c of cleanup.splice(0)) {
    c.dispose?.();
    c.destroy?.();
  }
  host?.remove();
});

function mount(): HTMLElement {
  host = document.createElement('div');
  host.style.width = '1000px';
  document.body.appendChild(host);
  return host;
}

function resources(): ResourceModel[] {
  return [
    { id: 'r1', name: 'Alice' },
    { id: 'r2', name: 'Bob' },
  ];
}
function events(): EventModel[] {
  return [
    { id: 'e1', resourceId: 'r1', name: 'Workshop', startDate: start, endDate: start + DAY },
    {
      id: 'e2',
      resourceId: 'r2',
      name: 'Daily Standup',
      startDate: start + DAY,
      endDate: start + DAY + 3_600_000,
      recurrenceRule: 'FREQ=DAILY;COUNT=3',
    },
  ];
}

function buildScheduler(): { sched: Scheduler; bar: HTMLElement } {
  const h = mount();
  const bar = document.createElement('div');
  h.appendChild(bar);
  const schedHost = document.createElement('div');
  schedHost.style.height = '320px';
  h.appendChild(schedHost);
  const sched = new Scheduler(schedHost, {
    resources: resources(),
    events: events(),
    preset: WEEK_AND_DAY,
    range: { start, end: start + DAY * 7 },
  });
  cleanup.push(sched);
  return { sched, bar };
}

describe('Scheduler ICS export/import (browser)', () => {
  it('renders an accessible export/import toolbar with zero serious axe violations', async () => {
    const { sched, bar } = buildScheduler();
    const toolbar = mountIcsToolbar(bar, sched.getEventStore(), {
      exportOptions: { now: start },
    });
    cleanup.push(toolbar);

    const root = toolbar.el;
    expect(root.getAttribute('role')).toBe('toolbar');
    expect(root.getAttribute('aria-label')).toBe('iCalendar export and import');

    const exportBtn = root.querySelector('.jects-scheduler-ics__btn--primary') as HTMLButtonElement;
    expect(exportBtn).toBeTruthy();
    expect(exportBtn.tagName).toBe('BUTTON');
    expect(exportBtn.textContent).toContain('Export');

    // Token-pure CSS actually applied: the primary button has a non-default
    // (themed) background painted by the browser.
    const bg = getComputedStyle(exportBtn).backgroundColor;
    expect(bg).not.toBe('');
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');

    // Scope axe to the ICS toolbar surface (the feature under test); the
    // scheduler grid mounted alongside is a separate component with its own
    // a11y coverage.
    await expectNoA11yViolations(root);
  });

  it('round-trips the live store: export to ICS, clear, re-import, repaint bars', () => {
    const { sched } = buildScheduler();
    const store = sched.getEventStore();

    // Export the current store to ICS.
    const ics = new IcsExporter(store, { now: start }).toIcs();
    expect(ics).toContain('SUMMARY:Workshop');
    expect(ics).toContain('RRULE:FREQ=DAILY;COUNT=3');
    expect(ics).toContain('X-JECTS-RESOURCE:r2');

    // Clear the store — bars vanish.
    store.remove(store.toArray().map((e) => e.id));
    expect(store.count).toBe(0);

    // Re-import the ICS — events return to their lanes.
    const added = new IcsImporter(store).import(ics);
    expect(added.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
    expect(store.getById('e1')!.resourceId).toBe('r1');
    expect(store.getById('e2')!.resourceId).toBe('r2');
    expect(store.getById('e2')!.recurrenceRule).toBe('RRULE:FREQ=DAILY;COUNT=3');

    // The scheduler repaints real bars for the re-imported events.
    const bars = host.querySelectorAll('[data-event-id], .jects-scheduler__event');
    expect(bars.length).toBeGreaterThan(0);
  });
});
