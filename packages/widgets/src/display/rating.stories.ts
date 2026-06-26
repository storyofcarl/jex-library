/** Rating stories — framework-free usage examples for the docs app. */
import { Rating, type RatingConfig } from './rating.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Rating;
}

const story = (name: string, config: RatingConfig): Story => ({
  name,
  render: (host) => new Rating(host, config),
});

export const stories: Story[] = [
  story('Default', { max: 5, value: 3 }),
  story('Half stars', { max: 5, value: 3.5, allowHalf: true }),
  story('Read-only', { max: 5, value: 4, readOnly: true }),
  story('Ten stars', { max: 10, value: 7 }),
  story('Disabled', { max: 5, value: 2, disabled: true }),
];
