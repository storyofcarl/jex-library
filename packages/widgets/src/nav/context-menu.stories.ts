/** ContextMenu stories — canonical usage examples. */
import { ContextMenu } from './context-menu.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => ContextMenu;
}

export const stories: Story[] = [
  {
    name: 'Right-click target',
    render: (host) => {
      const target = document.createElement('div');
      target.textContent = 'Right-click anywhere in this box';
      target.style.cssText =
        'padding:3rem;border:1px dashed currentColor;border-radius:8px;text-align:center;';
      host.appendChild(target);
      return new ContextMenu(host, {
        target,
        items: [
          { id: 'cut', text: 'Cut', icon: 'minus' },
          { id: 'copy', text: 'Copy' },
          { id: 'paste', text: 'Paste' },
          { separator: true },
          {
            id: 'more',
            text: 'More',
            children: [
              { id: 'rename', text: 'Rename', icon: 'edit' },
              { id: 'delete', text: 'Delete', icon: 'trash' },
            ],
          },
        ],
      });
    },
  },
];
