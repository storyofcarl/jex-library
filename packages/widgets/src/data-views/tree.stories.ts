/** Tree stories — framework-free usage examples for the docs app. */
import { Tree, type TreeConfig } from './tree.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Tree;
}

const fileTree = [
  {
    id: 'src',
    text: 'src',
    children: [
      { id: 'index', text: 'index.ts' },
      {
        id: 'components',
        text: 'components',
        children: [
          { id: 'button', text: 'button.ts' },
          { id: 'tree', text: 'tree.ts' },
        ],
      },
    ],
  },
  { id: 'readme', text: 'README.md' },
];

const story = (name: string, config: TreeConfig): Story => ({
  name,
  render: (host) => new Tree(host, config),
});

export const stories: Story[] = [
  story('Basic', { data: fileTree }),
  story('With checkboxes', { data: fileTree, checkboxes: true }),
  story('Multi-select', { data: fileTree, selectionMode: 'multi' }),
  story('Wide indent', { data: fileTree, indent: 28 }),
];
