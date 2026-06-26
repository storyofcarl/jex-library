/** DisplayField stories — framework-free usage examples for the docs app. */
import { DisplayField, type DisplayFieldConfig } from './display-field.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => DisplayField;
}

const story = (name: string, config: DisplayFieldConfig): Story => ({
  name,
  render: (host) => new DisplayField(host, config),
});

export const stories: Story[] = [
  story('Stacked', { label: 'Full name', value: 'Jane Doe' }),
  story('Inline', { label: 'Status', value: 'Active', layout: 'inline' }),
  story('Empty fallback', { label: 'Phone', empty: 'Not provided' }),
  story('Large', { label: 'Total', value: '$1,240.00', size: 'lg' }),
];
