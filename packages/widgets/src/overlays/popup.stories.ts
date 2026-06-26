/**
 * Popup stories — framework-free usage examples. Each story mounts a trigger
 * button plus a Popup anchored to it, and wires the trigger to toggle the popup.
 */
import { Popup, type PopupConfig } from './popup.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Popup;
}

const story = (
  name: string,
  config: Omit<PopupConfig, 'anchor'>,
  label = 'Open',
): Story => ({
  name,
  render: (host) => {
    const trigger = document.createElement('button');
    trigger.className = 'jects-btn jects-btn--outline jects-btn--md';
    trigger.textContent = label;
    host.appendChild(trigger);
    const popup = new Popup(host, { ...config, anchor: trigger });
    trigger.addEventListener('click', () => popup.toggle());
    return popup;
  },
});

export const stories: Story[] = [
  story('Bottom (default)', { text: 'Anchored below', placement: 'bottom' }),
  story('Top', { text: 'Anchored above', placement: 'top' }),
  story('Right + align start', { text: 'To the right', placement: 'right', align: 'start' }),
  story('Left', { text: 'To the left', placement: 'left' }),
  story('Rich content', {
    html: '<strong>Menu</strong><ul><li>One</li><li>Two</li></ul>',
    placement: 'bottom',
    align: 'start',
  }),
  story('No flip', { text: 'Never flips', placement: 'bottom', flip: false }),
  story('Stays open on Esc', { text: 'Esc disabled', closeOnEsc: false }),
];
