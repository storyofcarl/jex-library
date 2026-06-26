/** TextField stories — framework-free usage examples for the docs app. */
import { TextField, type TextFieldConfig } from './text-field.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => TextField;
}

const story = (name: string, config: TextFieldConfig): Story => ({
  name,
  render: (host) => new TextField(host, config),
});

export const stories: Story[] = [
  story('Basic', { label: 'Name', placeholder: 'Jane Doe' }),
  story('With value', { label: 'Email', value: 'jane@example.com', inputType: 'email' }),
  story('Required', { label: 'Username', required: true, placeholder: 'Required' }),
  story('Clearable', { label: 'Search', clearable: true, value: 'query', inputType: 'search' }),
  story('Prefix + suffix', { label: 'Price', prefix: '$', suffix: 'USD', value: '19.99' }),
  story('Invalid', { label: 'Email', value: 'nope', error: 'Enter a valid email' }),
  story('Disabled', { label: 'Locked', value: 'cannot edit', disabled: true }),
  story('Read-only', { label: 'ID', value: 'usr_123', readOnly: true }),
  story('Small', { label: 'Small', size: 'sm', placeholder: 'sm' }),
  story('Large', { label: 'Large', size: 'lg', placeholder: 'lg' }),
];
