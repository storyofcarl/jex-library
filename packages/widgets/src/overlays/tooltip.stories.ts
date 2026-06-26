/**
 * Tooltip stories — framework-free usage examples. Each story mounts a target
 * element and attaches a Tooltip to it (hover or focus to reveal).
 */
import { Tooltip, type TooltipConfig } from './tooltip.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Tooltip;
}

const story = (
  name: string,
  config: Omit<TooltipConfig, 'target'>,
  label = 'Hover me',
): Story => ({
  name,
  render: (host) => {
    const target = document.createElement('button');
    target.className = 'jects-btn jects-btn--secondary jects-btn--md';
    target.textContent = label;
    host.appendChild(target);
    return new Tooltip(host, { ...config, target });
  },
});

export const stories: Story[] = [
  story('Top (default)', { text: 'Tooltip on top', placement: 'top' }),
  story('Bottom', { text: 'Tooltip below', placement: 'bottom' }),
  story('Left', { text: 'Left side', placement: 'left' }),
  story('Right', { text: 'Right side', placement: 'right' }),
  story('Slow show', { text: 'Patient tooltip', showDelay: 600 }),
  story('Instant', { text: 'No delay', showDelay: 0 }),
];
