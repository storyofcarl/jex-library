/** NumberField stories — framework-free usage examples for the docs app. */
import { NumberField, type NumberFieldConfig } from './number-field.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => NumberField;
}

const story = (name: string, config: NumberFieldConfig): Story => ({
  name,
  render: (host) => new NumberField(host, config),
});

export const stories: Story[] = [
  story('Basic', { label: 'Quantity', value: '1' }),
  story('Min / max / step', { label: 'Volume', value: '50', min: 0, max: 100, step: 5 }),
  story('Precision (2dp)', { label: 'Amount', value: '9.5', precision: 2, prefix: '$' }),
  story('No spinners', { label: 'Year', value: '2026', spinners: false }),
  story('Disabled', { label: 'Locked', value: '10', disabled: true }),
];
