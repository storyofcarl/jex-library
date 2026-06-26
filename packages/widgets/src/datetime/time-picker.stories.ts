/** TimePicker stories — canonical usage examples for the docs app. */
import { TimePicker, type TimePickerConfig } from './time-picker.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => TimePicker;
}

const story = (name: string, config: TimePickerConfig): Story => ({
  name,
  render: (host) => new TimePicker(host, config),
});

export const stories: Story[] = [
  story('12-hour', { value: { hours: 9, minutes: 30 }, hour12: true }),
  story('24-hour', { value: { hours: 18, minutes: 45 }, hour12: false }),
  story('15-minute step', { value: { hours: 13, minutes: 0 }, step: 15 }),
  story('Disabled', { value: { hours: 8, minutes: 0 }, disabled: true }),
];
