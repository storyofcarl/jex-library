/** ComboBox stories — framework-free usage examples for the docs app. */
import { ComboBox, type ComboBoxConfig } from './combobox.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => ComboBox;
}

const story = (name: string, config: ComboBoxConfig): Story => ({
  name,
  render: (host) => new ComboBox(host, config),
});

const fruits = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
  { value: 'date', label: 'Date' },
  { value: 'elderberry', label: 'Elderberry' },
];

export const stories: Story[] = [
  story('Autocomplete (single)', { options: fruits, placeholder: 'Search fruit…', ariaLabel: 'Fruit' }),
  story('Preselected (single)', { options: fruits, value: 'cherry', ariaLabel: 'Fruit' }),
  story('Multiselect chips', {
    options: fruits,
    multiple: true,
    values: ['apple', 'cherry'],
    placeholder: 'Add fruit…',
    ariaLabel: 'Fruits',
  }),
  story('Disabled', { options: fruits, value: 'banana', disabled: true, ariaLabel: 'Fruit' }),
];
