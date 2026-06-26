/** Toolbar stories — canonical usage examples. */
import { Toolbar, type ToolbarConfig } from './toolbar.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Toolbar;
}

const story = (name: string, config: ToolbarConfig): Story => ({
  name,
  render: (host) => new Toolbar(host, config),
});

export const stories: Story[] = [
  story('Formatting', {
    items: [
      { id: 'bold', icon: 'plus', label: 'Bold' },
      { id: 'italic', icon: 'minus', label: 'Italic' },
      { separator: true },
      { id: 'search', icon: 'search', label: 'Find' },
      { id: 'filter', icon: 'filter', label: 'Filter' },
    ],
  }),
  story('With labels', {
    items: [
      { id: 'new', text: 'New', icon: 'plus', variant: 'primary' },
      { id: 'edit', text: 'Edit', icon: 'edit' },
      { id: 'delete', text: 'Delete', icon: 'trash', variant: 'ghost' },
    ],
  }),
  story('Overflow', {
    overflowAfter: 3,
    items: [
      { id: 'a', icon: 'plus', label: 'Add' },
      { id: 'b', icon: 'minus', label: 'Remove' },
      { id: 'c', icon: 'edit', label: 'Edit' },
      { id: 'd', icon: 'trash', label: 'Delete' },
      { id: 'e', icon: 'search', label: 'Find' },
      { id: 'f', icon: 'filter', label: 'Filter' },
    ],
  }),
  story('Vertical', {
    orientation: 'vertical',
    items: [
      { id: 'up', icon: 'arrow-up', label: 'Up' },
      { id: 'down', icon: 'arrow-down', label: 'Down' },
    ],
  }),
];
