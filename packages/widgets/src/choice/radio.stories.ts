/** Radio stories — framework-free usage examples for the docs app. */
import { Radio, type RadioConfig } from './radio.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Radio;
}

const story = (name: string, config: RadioConfig): Story => ({
  name,
  render: (host) => new Radio(host, config),
});

export const stories: Story[] = [
  story('Unselected', { label: 'Standard', value: 'standard', name: 'plan' }),
  story('Selected', { label: 'Pro', value: 'pro', name: 'plan', checked: true }),
  story('Disabled', { label: 'Enterprise', value: 'ent', name: 'plan', disabled: true }),
];
