/**
 * Container stories — framework-free usage examples.
 */
import { Container, type ContainerConfig } from './container.js';
import '../button/button.js'; // registers 'button' for factory items

export interface Story {
  name: string;
  render: (host: HTMLElement) => Container;
}

const story = (name: string, config: ContainerConfig): Story => ({
  name,
  render: (host) => new Container(host, config),
});

export const stories: Story[] = [
  story('Flex row (toolbar)', {
    role: 'toolbar',
    ariaLabel: 'Actions',
    gap: 2,
    align: 'center',
    items: [
      { type: 'button', text: 'Save', variant: 'primary' },
      { type: 'button', text: 'Cancel', variant: 'ghost' },
    ],
  }),
  story('Flex column', {
    direction: 'column',
    gap: 3,
    items: [
      { type: 'button', text: 'First' },
      { type: 'button', text: 'Second' },
    ],
  }),
  story('Justify between', {
    justify: 'between',
    align: 'center',
    items: ['<strong>Title</strong>', { type: 'button', text: 'Action' }],
  }),
  story('Grid (3 columns)', {
    layout: 'grid',
    columns: 3,
    gap: 4,
    items: [
      { type: 'button', text: '1' },
      { type: 'button', text: '2' },
      { type: 'button', text: '3' },
      { type: 'button', text: '4' },
      { type: 'button', text: '5' },
      { type: 'button', text: '6' },
    ],
  }),
  story('Wrapping flex', {
    wrap: true,
    gap: 2,
    items: Array.from({ length: 8 }, (_, i) => ({ type: 'button', text: `Tag ${i + 1}`, variant: 'outline' as const })),
  }),
];
