/** DateTimeField stories — canonical usage examples for the docs app. */
import { DateTimeField, type DateTimeFieldConfig } from './date-time-field.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => DateTimeField;
}

const story = (name: string, config: DateTimeFieldConfig): Story => ({
  name,
  render: (host) => new DateTimeField(host, config),
});

export const stories: Story[] = [
  story('Empty', {}),
  story('With value (12h)', { value: new Date(2026, 5, 10, 9, 30) }),
  story('24-hour', { value: new Date(2026, 5, 10, 18, 15), hour12: false }),
  story('15-minute step', { value: new Date(2026, 5, 10, 13, 0), step: 15 }),
  story('Disabled', { value: new Date(2026, 5, 10, 9, 30), disabled: true }),
];
