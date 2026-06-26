/** RangeSlider stories — framework-free usage examples for the docs app. */
import { RangeSlider, type RangeSliderConfig } from './range-slider.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => RangeSlider;
}

const story = (name: string, config: RangeSliderConfig): Story => ({
  name,
  render: (host) => new RangeSlider(host, config),
});

export const stories: Story[] = [
  story('Default', { min: 0, max: 100, low: 25, high: 75 }),
  story('Price range', { min: 0, max: 1000, step: 50, low: 200, high: 600 }),
  story('Disabled', { min: 0, max: 100, low: 30, high: 70, disabled: true }),
];
