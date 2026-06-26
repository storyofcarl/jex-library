/** Select stories — framework-free usage examples for the docs app. */
import { Select, type SelectConfig } from './select.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Select;
}

const story = (name: string, config: SelectConfig): Story => ({
  name,
  render: (host) => new Select(host, config),
});

const colors = [
  { value: 'red', label: 'Red' },
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
  { value: 'violet', label: 'Violet', disabled: true },
];

export const stories: Story[] = [
  story('Placeholder', { options: colors, placeholder: 'Choose a color', ariaLabel: 'Color' }),
  story('Preselected', { options: colors, value: 'green', ariaLabel: 'Color' }),
  story('Clearable', { options: colors, value: 'blue', clearable: true, ariaLabel: 'Color' }),
  story('Disabled', { options: colors, value: 'red', disabled: true, ariaLabel: 'Color' }),
];
