/** CheckboxGroup stories — framework-free usage examples for the docs app. */
import { CheckboxGroup, type CheckboxGroupConfig } from './checkbox-group.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => CheckboxGroup;
}

const story = (name: string, config: CheckboxGroupConfig): Story => ({
  name,
  render: (host) => new CheckboxGroup(host, config),
});

const toppings = [
  { value: 'cheese', label: 'Cheese' },
  { value: 'mushroom', label: 'Mushroom' },
  { value: 'olive', label: 'Olive' },
];

export const stories: Story[] = [
  story('Vertical', { options: toppings, value: ['cheese'], ariaLabel: 'Toppings' }),
  story('Horizontal', { options: toppings, value: ['cheese', 'olive'], orientation: 'horizontal', ariaLabel: 'Toppings' }),
  story('With disabled option', {
    options: [...toppings, { value: 'truffle', label: 'Truffle', disabled: true }],
    value: ['mushroom'],
    ariaLabel: 'Toppings',
  }),
];
