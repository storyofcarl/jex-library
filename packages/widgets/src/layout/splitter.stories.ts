/**
 * Splitter stories — framework-free usage examples.
 */
import { Splitter, type SplitterConfig } from './splitter.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Splitter;
}

const story = (name: string, config: SplitterConfig): Story => ({
  name,
  render: (host) => {
    host.style.height = '240px';
    return new Splitter(host, config);
  },
});

const pane = (label: string): string =>
  `<div style="padding:1rem">${label}</div>`;

export const stories: Story[] = [
  story('Horizontal (50/50)', {
    orientation: 'horizontal',
    first: pane('Left'),
    second: pane('Right'),
  }),
  story('Vertical (30/70)', {
    orientation: 'vertical',
    ratio: 0.3,
    first: pane('Top'),
    second: pane('Bottom'),
  }),
  story('Constrained min/max', {
    orientation: 'horizontal',
    ratio: 0.5,
    min: 0.25,
    max: 0.75,
    first: pane('Min 25%'),
    second: pane('Max 75%'),
  }),
  story('Persisted ratio', {
    orientation: 'horizontal',
    persist: 'jects-story-splitter',
    first: pane('Resize me'),
    second: pane('Ratio remembered'),
  }),
  story('Disabled', {
    orientation: 'horizontal',
    disabled: true,
    first: pane('Fixed'),
    second: pane('Fixed'),
  }),
];
