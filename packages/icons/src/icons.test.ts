import { describe, it, expect } from 'vitest';
import { renderIcon, iconNames, spriteId } from './index.js';

describe('icons', () => {
  it('exposes a real icon set', () => {
    expect(iconNames.length).toBeGreaterThanOrEqual(20);
    expect(iconNames).toContain('search');
    expect(iconNames).toContain('chevron-down');
    expect(iconNames).toContain('check');
  });

  it('renders inline SVG with currentColor stroke', () => {
    const svg = renderIcon('search', { size: 16 });
    expect(svg).toContain('width="16"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('class="jects-icon"');
    expect(svg).toContain('aria-hidden="true"');
  });

  it('adds aria-label when a label is given', () => {
    const svg = renderIcon('close', { label: 'Close' });
    expect(svg).toContain('aria-label="Close"');
    expect(svg).toContain('role="img"');
  });

  it('spriteId is namespaced', () => {
    expect(spriteId('check')).toBe('jects-i-check');
  });
});
