/** Spacer stories — framework-free usage examples for the docs app. */
import { Spacer, type SpacerConfig } from './spacer.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Spacer;
}

const story = (name: string, config: SpacerConfig): Story => ({
  name,
  render: (host) => new Spacer(host, config),
});

export const stories: Story[] = [
  story('Vertical (4)', { axis: 'vertical', size: 4 }),
  story('Vertical (8)', { axis: 'vertical', size: 8 }),
  story('Horizontal (6)', { axis: 'horizontal', size: 6 }),
  story('Custom length', { axis: 'vertical', size: '3rem' }),
  story('Grow', { grow: true }),
];
