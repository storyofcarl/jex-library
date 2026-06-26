/** Link stories — framework-free usage examples for the docs app. */
import { Link, type LinkConfig } from './link.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Link;
}

const story = (name: string, config: LinkConfig): Story => ({
  name,
  render: (host) => new Link(host, config),
});

export const stories: Story[] = [
  story('Default', { text: 'Read the docs', href: 'https://example.test' }),
  story('Muted', { text: 'Learn more', href: 'https://example.test', variant: 'muted' }),
  story('Underline', { text: 'Terms', href: 'https://example.test', variant: 'underline' }),
  story('Plain', { text: 'Profile', href: 'https://example.test', variant: 'plain' }),
  story('New tab', { text: 'Open external', href: 'https://example.test', target: '_blank' }),
  story('Disabled', { text: 'Unavailable', href: 'https://example.test', disabled: true }),
];
