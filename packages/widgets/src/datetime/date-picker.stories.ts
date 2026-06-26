/** DatePicker stories — canonical usage examples for the docs app. */
import { DatePicker, type DatePickerConfig } from './date-picker.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => DatePicker;
}

const story = (name: string, config: DatePickerConfig): Story => ({
  name,
  render: (host) => new DatePicker(host, config),
});

export const stories: Story[] = [
  story('Empty', { placeholder: 'YYYY-MM-DD' }),
  story('With value', { value: new Date(2026, 5, 10) }),
  story('Monday start', { value: new Date(2026, 5, 10), weekStart: 1 }),
  story('Bounded', { min: new Date(2026, 5, 1), max: new Date(2026, 5, 30) }),
  story('Disabled', { value: new Date(2026, 5, 10), disabled: true }),
];
