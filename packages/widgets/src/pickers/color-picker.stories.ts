/**
 * ColorPicker stories — framework-free usage examples for the docs app.
 */
import { ColorPicker, type ColorPickerConfig } from './color-picker.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => ColorPicker;
}

const story = (name: string, config: ColorPickerConfig): Story => ({
  name,
  render: (host) => new ColorPicker(host, config),
});

export const stories: Story[] = [
  story('Default (black)', { value: '#000000' }),
  story('Preset red', { value: '#ef4444' }),
  story('CMYK cyan', { value: '#00aeef' }),
  story('With alpha', { value: '#3b82f680', alpha: true }),
  story('No alpha', { value: '#22c55e', alpha: false }),
  story('Custom swatches', {
    value: '#111111',
    swatches: ['#111111', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'],
  }),
  story('Disabled', { value: '#777777', disabled: true }),
];
