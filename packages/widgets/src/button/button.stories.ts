/**
 * Button stories — framework-free "stories" used by the docs app and as a
 * canonical usage example. Each story returns a host-mounting function.
 */
import { Button, type ButtonConfig } from './button.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Button;
}

const story = (name: string, config: ButtonConfig): Story => ({
  name,
  render: (host) => new Button(host, config),
});

export const stories: Story[] = [
  story('Primary', { text: 'Primary', variant: 'primary' }),
  story('Secondary', { text: 'Secondary', variant: 'secondary' }),
  story('Destructive', { text: 'Delete', variant: 'destructive', icon: 'trash' }),
  story('Outline', { text: 'Outline', variant: 'outline' }),
  story('Ghost', { text: 'Ghost', variant: 'ghost' }),
  story('Link', { text: 'Link', variant: 'link' }),
  story('With icon (start)', { text: 'Search', icon: 'search', iconAlign: 'start' }),
  story('With icon (end)', { text: 'Next', icon: 'chevron-right', iconAlign: 'end' }),
  story('Icon only', { icon: 'plus', variant: 'outline' }),
  story('Small', { text: 'Small', size: 'sm' }),
  story('Large', { text: 'Large', size: 'lg' }),
  story('Disabled', { text: 'Disabled', disabled: true }),
  story('Loading', { text: 'Saving', loading: true }),
];
