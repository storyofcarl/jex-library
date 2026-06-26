/** TextArea stories — framework-free usage examples for the docs app. */
import { TextArea, type TextAreaConfig } from './text-area.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => TextArea;
}

const story = (name: string, config: TextAreaConfig): Story => ({
  name,
  render: (host) => new TextArea(host, config),
});

export const stories: Story[] = [
  story('Basic', { label: 'Bio', placeholder: 'Tell us about yourself', rows: 4 }),
  story('Auto-grow', { label: 'Notes', autoGrow: true, value: 'Type to grow…' }),
  story('With counter', { label: 'Tweet', maxLength: 280, value: 'Hello world' }),
  story('Invalid', { label: 'Comment', error: 'Comment is required' }),
  story('Disabled', { label: 'Locked', value: 'read only', disabled: true }),
];
