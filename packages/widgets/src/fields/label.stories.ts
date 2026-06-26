/** Label stories — framework-free usage examples for the docs app. */
import { Label, type LabelConfig } from './label.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Label;
}

const story = (name: string, config: LabelConfig): Story => ({
  name,
  render: (host) => new Label(host, config),
});

export const stories: Story[] = [
  story('Basic', { text: 'Email address', htmlFor: 'email' }),
  story('Required', { text: 'Password', htmlFor: 'pw', required: true }),
  story('Small', { text: 'Caption', size: 'sm' }),
  story('Large', { text: 'Section', size: 'lg' }),
];
