/** RadioGroup stories — framework-free usage examples for the docs app. */
import { RadioGroup, type RadioGroupConfig } from './radio-group.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => RadioGroup;
}

const story = (name: string, config: RadioGroupConfig): Story => ({
  name,
  render: (host) => new RadioGroup(host, config),
});

const plans = [
  { value: 'free', label: 'Free' },
  { value: 'pro', label: 'Pro' },
  { value: 'team', label: 'Team' },
];

export const stories: Story[] = [
  story('Vertical', { options: plans, value: 'pro', ariaLabel: 'Plan' }),
  story('Horizontal', { options: plans, value: 'free', orientation: 'horizontal', ariaLabel: 'Plan' }),
  story('With disabled option', {
    options: [...plans, { value: 'ent', label: 'Enterprise', disabled: true }],
    value: 'team',
    ariaLabel: 'Plan',
  }),
  story('Group disabled', { options: plans, value: 'pro', disabled: true, ariaLabel: 'Plan' }),
];
