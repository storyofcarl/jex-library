/** Checkbox stories — framework-free usage examples for the docs app. */
import { Checkbox, type CheckboxConfig } from './checkbox.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Checkbox;
}

const story = (name: string, config: CheckboxConfig): Story => ({
  name,
  render: (host) => new Checkbox(host, config),
});

export const stories: Story[] = [
  story('Unchecked', { label: 'Subscribe' }),
  story('Checked', { label: 'Remember me', checked: true }),
  story('Indeterminate', { label: 'Select all', indeterminate: true }),
  story('Disabled', { label: 'Disabled', disabled: true }),
  story('Disabled checked', { label: 'Locked on', disabled: true, checked: true }),
];
