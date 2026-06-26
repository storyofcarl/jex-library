/** Ribbon stories — canonical usage examples. */
import { Ribbon, type RibbonConfig } from './ribbon.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Ribbon;
}

const story = (name: string, config: RibbonConfig): Story => ({
  name,
  render: (host) => new Ribbon(host, config),
});

export const stories: Story[] = [
  story('Office-style', {
    tabs: [
      {
        id: 'home',
        text: 'Home',
        groups: [
          {
            title: 'Clipboard',
            commands: [
              { id: 'paste', text: 'Paste', icon: 'plus' },
              { id: 'cut', icon: 'minus', label: 'Cut' },
              { id: 'copy', icon: 'check', label: 'Copy' },
            ],
          },
          {
            title: 'Editing',
            commands: [
              { id: 'find', icon: 'search', label: 'Find' },
              { id: 'filter', icon: 'filter', label: 'Filter' },
            ],
          },
        ],
      },
      {
        id: 'insert',
        text: 'Insert',
        groups: [
          {
            title: 'Tables',
            commands: [{ id: 'table', text: 'Table', icon: 'menu' }],
          },
          {
            title: 'Media',
            commands: [
              { id: 'image', text: 'Image', icon: 'edit' },
              { id: 'link', text: 'Link', icon: 'chevron-right' },
            ],
          },
        ],
      },
      {
        id: 'view',
        text: 'View',
        groups: [
          {
            title: 'Zoom',
            commands: [
              { id: 'zoom-in', icon: 'plus', label: 'Zoom In' },
              { id: 'zoom-out', icon: 'minus', label: 'Zoom Out' },
            ],
          },
        ],
      },
    ],
  }),
];
