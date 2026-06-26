/**
 * @jects/calendar — usage stories / docs examples.
 *
 * These are framework-free factory functions that mount a Calendar into a host
 * element. The docs shell renders each `render(host)` and labels it with `title`.
 */

import { Calendar } from './calendar.js';
import type { CalendarConfig, CalendarEvent } from './contract.js';

export interface Story {
  title: string;
  description: string;
  render(host: HTMLElement): Calendar;
}

const today = new Date();
const Y = today.getFullYear();
const M = today.getMonth();
const D = today.getDate();

function at(dayOffset: number, hour: number, min = 0): Date {
  return new Date(Y, M, D + dayOffset, hour, min);
}

const categories = [
  { id: 'work', name: 'Work', color: 'data-1' },
  { id: 'personal', name: 'Personal', color: 'data-2' },
  { id: 'travel', name: 'Travel', color: 'data-3' },
  { id: 'health', name: 'Health', color: 'data-4' },
];

const resources = [
  { id: 'room-a', name: 'Conference A' },
  { id: 'room-b', name: 'Conference B' },
  { id: 'room-c', name: 'Studio' },
];

function demoEvents(): CalendarEvent[] {
  return [
    { id: 1, title: 'Team standup', start: at(0, 9, 0), end: at(0, 9, 30), categoryId: 'work', resourceId: 'room-a',
      recurrence: { freq: 'weekly', byWeekday: [1, 2, 3, 4, 5] } },
    { id: 2, title: 'Design review', start: at(0, 11, 0), end: at(0, 12, 30), categoryId: 'work', resourceId: 'room-b' },
    { id: 3, title: 'Lunch w/ Sam', start: at(0, 12, 30), end: at(0, 13, 30), categoryId: 'personal' },
    { id: 4, title: 'Flight to NYC', start: at(2, 0, 0), end: at(4, 0, 0), allDay: true, categoryId: 'travel' },
    { id: 5, title: 'Gym', start: at(0, 18, 0), end: at(0, 19, 0), categoryId: 'health', resourceId: 'room-c',
      recurrence: { freq: 'daily', interval: 2, count: 12 } },
    { id: 6, title: 'Sprint planning', start: at(1, 14, 0), end: at(1, 16, 0), categoryId: 'work', resourceId: 'room-a' },
    { id: 7, title: 'Monthly all-hands', start: at(0, 15, 0), end: at(0, 16, 0), categoryId: 'work',
      recurrence: { freq: 'monthly', count: 6 } },
  ];
}

function make(host: HTMLElement, config: Partial<CalendarConfig>): Calendar {
  host.style.height = '640px';
  return new Calendar(host, { date: today, events: demoEvents(), categories, resources, ...config });
}

export const stories: Story[] = [
  {
    title: 'Month view',
    description: 'The default month grid with mini-calendar, category + resource filters, and recurring events.',
    render: (host) => make(host, { view: 'month' }),
  },
  {
    title: 'Week view',
    description: 'A time grid for the current week with an all-day rail, drag-create/move/resize, and overlap packing.',
    render: (host) => make(host, { view: 'week' }),
  },
  {
    title: 'Day view',
    description: 'A single-day time grid with a live "now" indicator.',
    render: (host) => make(host, { view: 'day' }),
  },
  {
    title: 'Year view',
    description: 'A 12-month heat overview; click a month or day to drill in.',
    render: (host) => make(host, { view: 'year' }),
  },
  {
    title: 'Agenda view',
    description: 'A compact chronological list of the week’s events.',
    render: (host) => make(host, { view: 'agenda' }),
  },
  {
    title: 'Resource view',
    description: 'One column per resource for a single day — schedule rooms / people side by side.',
    render: (host) => make(host, { view: 'resource' }),
  },
  {
    title: 'Read-only (no editor)',
    description: 'Drag interactions and the editor disabled; events are click-to-inspect only.',
    render: (host) => make(host, { view: 'week', editable: false, editor: false }),
  },
  {
    title: 'Week-starts-Monday, business hours',
    description: 'Week starting Monday, constrained to 7:00–20:00.',
    render: (host) => make(host, { view: 'week', weekStart: 1, dayStartHour: 7, dayEndHour: 20 }),
  },
];

export default stories;
