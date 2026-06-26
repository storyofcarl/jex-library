/** Slider stories — framework-free usage examples for the docs app. */
import { Slider, type SliderConfig } from './slider.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Slider;
}

const story = (name: string, config: SliderConfig): Story => ({
  name,
  render: (host) => new Slider(host, config),
});

export const stories: Story[] = [
  story('Default', { min: 0, max: 100, value: 40 }),
  story('Stepped', { min: 0, max: 10, step: 2, value: 6 }),
  story('With label', { min: 0, max: 100, value: 25, label: 'Volume' }),
  story('Disabled', { min: 0, max: 100, value: 60, disabled: true }),
];
