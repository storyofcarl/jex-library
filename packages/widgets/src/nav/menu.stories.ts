/** Menu stories — canonical usage examples. */
import { Menu, type MenuConfig } from './menu.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Menu;
}

const story = (name: string, config: MenuConfig): Story => ({
  name,
  render: (host) => new Menu(host, config),
});

export const stories: Story[] = [
  story('Basic', {
    items: [
      { id: 'new', text: 'New', icon: 'plus', shortcut: 'Ctrl+N' },
      { id: 'open', text: 'Open', shortcut: 'Ctrl+O' },
      { separator: true },
      { id: 'save', text: 'Save', icon: 'check', shortcut: 'Ctrl+S' },
    ],
  }),
  story('Checkable', {
    items: [
      { id: 'wrap', text: 'Word Wrap', checkable: true, checked: true },
      { id: 'minimap', text: 'Minimap', checkable: true },
      { id: 'whitespace', text: 'Render Whitespace', checkable: true },
    ],
  }),
  story('Submenus', {
    items: [
      { id: 'edit', text: 'Edit' },
      {
        id: 'recent',
        text: 'Open Recent',
        children: [
          { id: 'r1', text: 'project-a' },
          { id: 'r2', text: 'project-b' },
          { separator: true },
          { id: 'clear', text: 'Clear Recent', icon: 'trash' },
        ],
      },
      { separator: true },
      { id: 'exit', text: 'Exit', disabled: true },
    ],
  }),
  story('Menubar', {
    variant: 'menubar',
    items: [
      { id: 'file', text: 'File', children: [{ id: 'f-new', text: 'New' }] },
      { id: 'edit', text: 'Edit', children: [{ id: 'e-undo', text: 'Undo' }] },
      { id: 'view', text: 'View', children: [{ id: 'v-zoom', text: 'Zoom In' }] },
    ],
  }),
];
