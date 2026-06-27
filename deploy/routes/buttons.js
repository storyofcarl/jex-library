/** Route: buttons. */
import { card } from '../shell/dom.js';
import { section, Button } from '../shell/registry.js';

export function register() {
  section('buttons', 'Buttons', 'Variants, sizes, icons, loading & disabled states.', (grid) => {
    const variants = [
      ['Primary', { text: 'Primary', variant: 'primary' }],
      ['Secondary', { text: 'Secondary', variant: 'secondary' }],
      ['Destructive', { text: 'Delete', variant: 'destructive', icon: 'trash' }],
      ['Outline', { text: 'Outline', variant: 'outline' }],
      ['Ghost', { text: 'Ghost', variant: 'ghost' }],
      ['Link', { text: 'Link', variant: 'link' }],
    ];
    grid.appendChild(card('Variants', (h) => variants.forEach(([, c]) => new Button(h, c))));
    grid.appendChild(card('Icons & sizes', (h) => {
      new Button(h, { text: 'Search', icon: 'search', iconAlign: 'start' });
      new Button(h, { text: 'Next', icon: 'chevron-right', iconAlign: 'end' });
      new Button(h, { icon: 'plus', variant: 'outline', ariaLabel: 'Add item' });
      new Button(h, { text: 'Small', size: 'sm' });
      new Button(h, { text: 'Large', size: 'lg' });
    }));
    grid.appendChild(card('States', (h) => {
      new Button(h, { text: 'Disabled', disabled: true });
      new Button(h, { text: 'Saving', loading: true });
    }));
  });
}
