/** Avatar stories — framework-free usage examples for the docs app. */
import { Avatar, type AvatarConfig } from './avatar.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Avatar;
}

const story = (name: string, config: AvatarConfig): Story => ({
  name,
  render: (host) => new Avatar(host, config),
});

export const stories: Story[] = [
  story('Image', { src: 'https://i.pravatar.cc/100', alt: 'User' }),
  story('Initials', { name: 'Ada Lovelace' }),
  story('Fallback glyph', {}),
  story('Small', { name: 'Sm', size: 'sm' }),
  story('Large', { name: 'Lg', size: 'lg' }),
  story('Extra large', { name: 'XL', size: 'xl' }),
  story('Square', { name: 'Sq', shape: 'square' }),
];
