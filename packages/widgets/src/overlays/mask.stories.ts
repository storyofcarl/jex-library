/**
 * Mask stories — framework-free usage examples. Each story mounts a positioned
 * container and overlays a Mask filling it.
 */
import { Mask, type MaskConfig } from './mask.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Mask;
}

const story = (name: string, config: MaskConfig): Story => ({
  name,
  render: (host) => {
    const panel = document.createElement('div');
    panel.style.position = 'relative';
    panel.style.minHeight = '160px';
    panel.style.padding = '16px';
    panel.textContent = 'Content behind the mask.';
    host.appendChild(panel);
    return new Mask(panel, config);
  },
});

export const stories: Story[] = [
  story('Spinner + message', { message: 'Loading…' }),
  story('Spinner only', {}),
  story('Message only', { spinner: false, message: 'Please wait' }),
  story('Pass-through', { blockInteraction: false, message: 'Non-blocking' }),
  story('Dismissible backdrop', { dismissible: true, message: 'Click outside to dismiss' }),
];
