/** Switch stories — framework-free usage examples for the docs app. */
import { Switch, type SwitchConfig } from './switch.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Switch;
}

const story = (name: string, config: SwitchConfig): Story => ({
  name,
  render: (host) => new Switch(host, config),
});

export const stories: Story[] = [
  story('Off', { label: 'Airplane mode' }),
  story('On', { label: 'Notifications', checked: true }),
  story('Disabled', { label: 'Disabled', disabled: true }),
  story('Disabled on', { label: 'Locked on', disabled: true, checked: true }),
];
