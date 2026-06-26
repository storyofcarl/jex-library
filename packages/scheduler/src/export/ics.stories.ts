/**
 * Usage stories for the ICS (iCalendar) export/import feature.
 *
 * These are plain, framework-free example functions (the house "stories" form):
 * each returns a description + a runnable closure demonstrating the API, so the
 * docs shell and integrators can copy real wiring.
 */

import { Scheduler } from '../view/scheduler.js';
import {
  toIcs,
  parseIcs,
  IcsExporter,
  IcsImporter,
  mountIcsToolbar,
  triggerIcsDownload,
} from './ics.js';
import { createEventStore } from '../stores/stores.js';
import type { EventModel, ResourceModel } from '../contract.js';

const DAY = 86_400_000;
const start = Date.UTC(2026, 0, 5);

const resources: ResourceModel[] = [
  { id: 'r1', name: 'Alice' },
  { id: 'r2', name: 'Bob' },
];
const events: EventModel[] = [
  { id: 'e1', resourceId: 'r1', name: 'Kickoff', startDate: start, endDate: start + DAY },
  {
    id: 'e2',
    resourceId: 'r2',
    name: 'Daily Standup',
    startDate: start + DAY,
    endDate: start + DAY + 3_600_000,
    recurrenceRule: 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',
  },
];

/** Serialize an event list straight to an ICS string (no scheduler needed). */
export const serializeToString = {
  title: 'ICS · serialize events to a string',
  run(): string {
    // Recurring events keep their RRULE; resources round-trip via X-JECTS-RESOURCE.
    return toIcs(events, { calendarName: 'Q1 Plan' });
  },
};

/** Export a live scheduler's store and trigger a .ics download. */
export const exportFromScheduler = {
  title: 'ICS · export a scheduler to a .ics download',
  run(host: HTMLElement): Scheduler {
    const scheduler = new Scheduler(host, { resources, events });
    const exporter = new IcsExporter(scheduler.getEventStore(), { fileName: 'q1-plan' });
    // In a real UI this is a button handler:
    exporter.download(); // → downloads "q1-plan.ics"
    return scheduler;
  },
};

/** Import an uploaded .ics file's events into a scheduler. */
export const importIntoScheduler = {
  title: 'ICS · import a .ics file into a scheduler',
  run(host: HTMLElement, icsText: string): EventModel[] {
    const scheduler = new Scheduler(host, { resources: [...resources], events: [] });
    const importer = new IcsImporter(scheduler.getEventStore(), {
      defaultResourceId: 'r1', // lane for events that carry no resource
      skipExisting: true,
    });
    return importer.import(icsText); // returns the events that were added
  },
};

/** Parse without importing (e.g. to preview before committing). */
export const parsePreview = {
  title: 'ICS · parse a .ics document for preview',
  run(icsText: string) {
    const parsed = parseIcs(icsText);
    return parsed.events.map((e) => ({ id: e.event.id, name: e.event.name, uid: e.uid }));
  },
};

/** Drop a themed, accessible Export/Import toolbar next to the scheduler. */
export const toolbar = {
  title: 'ICS · themed export/import toolbar',
  run(host: HTMLElement): Scheduler {
    const store = createEventStore(events);
    const scheduler = new Scheduler(host, { resources, events: store });
    const bar = document.createElement('div');
    host.prepend(bar);
    mountIcsToolbar(bar, scheduler.getEventStore(), {
      label: 'Calendar',
      onImport: (added) => console.info(`Imported ${added.length} event(s)`),
    });
    return scheduler;
  },
};

/** Download an arbitrary ICS string you already have. */
export const downloadString = {
  title: 'ICS · download an existing ICS string',
  run(): void {
    triggerIcsDownload(toIcs(events), 'plan.ics');
  },
};
