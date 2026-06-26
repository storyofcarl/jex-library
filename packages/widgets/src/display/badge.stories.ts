/** Badge stories — framework-free usage examples for the docs app. */
import { Badge, type BadgeConfig } from './badge.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Badge;
}

const story = (name: string, config: BadgeConfig): Story => ({
  name,
  render: (host) => new Badge(host, config),
});

export const stories: Story[] = [
  story('Primary', { text: 'Primary', variant: 'primary' }),
  story('Secondary', { text: 'Secondary', variant: 'secondary' }),
  story('Outline', { text: 'Outline', variant: 'outline' }),
  story('Success', { text: 'Active', variant: 'success', dot: true }),
  story('Warning', { text: 'Pending', variant: 'warning' }),
  story('Destructive', { text: 'Error', variant: 'destructive' }),
  story('Cyan', { text: 'Cyan', variant: 'cyan' }),
  story('Magenta', { text: 'Magenta', variant: 'magenta' }),
  story('Yellow', { text: 'Yellow', variant: 'yellow' }),
  story('Key', { text: 'Key', variant: 'key' }),
  story('Dismissable', { text: 'Filter', variant: 'secondary', dismissable: true }),
];
