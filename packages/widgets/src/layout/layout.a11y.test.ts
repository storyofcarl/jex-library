/**
 * axe-core a11y browser test for Layout (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Layout } from './layout.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '600px';
  host.style.height = '400px';
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Layout a11y (axe-core)', () => {
  it('has no serious/critical violations for a center-only layout', async () => {
    const l = new Layout(host, { center: { content: '<p>Main content</p>' } });
    await expectNoA11yViolations(host);
    l.destroy();
  });

  it('has no serious/critical violations with all edge regions and splitters', async () => {
    const l = new Layout(host, {
      north: { content: '<p>North</p>' },
      south: { content: '<p>South</p>' },
      west: { content: '<p>West</p>' },
      east: { content: '<p>East</p>' },
      center: { content: '<p>Center</p>' },
    });
    await expectNoA11yViolations(host);
    l.destroy();
  });

  it('has no serious/critical violations after collapse and expand', async () => {
    const l = new Layout(host, {
      west: { content: '<p>West</p>' },
      center: { content: '<p>Center</p>' },
    });
    l.collapse('west');
    expect(host.querySelector('.jects-layout__cell--west')).toBeNull();
    await expectNoA11yViolations(host);
    l.expand('west');
    expect(host.querySelector('.jects-layout__cell--west')).toBeTruthy();
    await expectNoA11yViolations(host);
    l.destroy();
  });
});
