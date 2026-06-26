/** ProgressBar stories — framework-free usage examples for the docs app. */
import { ProgressBar, type ProgressBarConfig } from './progress-bar.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => ProgressBar;
}

const story = (name: string, config: ProgressBarConfig): Story => ({
  name,
  render: (host) => new ProgressBar(host, config),
});

export const stories: Story[] = [
  story('Default', { value: 60 }),
  story('With label', { value: 45, showLabel: true }),
  story('Success', { value: 100, variant: 'success', showLabel: true }),
  story('Warning', { value: 70, variant: 'warning' }),
  story('Destructive', { value: 25, variant: 'destructive' }),
  story('Small', { value: 50, size: 'sm' }),
  story('Large', { value: 50, size: 'lg' }),
  story('Indeterminate', { indeterminate: true }),
];
