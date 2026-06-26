/** MiniCalendar stories — canonical usage examples for the docs app. */
import { MiniCalendar, type MiniCalendarConfig } from './mini-calendar.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => MiniCalendar;
}

const story = (name: string, config: MiniCalendarConfig): Story => ({
  name,
  render: (host) => new MiniCalendar(host, config),
});

const ref = new Date(2026, 5, 15);

export const stories: Story[] = [
  story('Default', { viewDate: ref }),
  story('With selection', { value: new Date(2026, 5, 10), viewDate: ref }),
  story('Monday start', { viewDate: ref, weekStart: 1 }),
  story('Min/max bounds', { viewDate: ref, min: new Date(2026, 5, 8), max: new Date(2026, 5, 22) }),
];
