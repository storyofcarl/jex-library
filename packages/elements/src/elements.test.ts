import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  register,
  elementDefinitions,
  JectsButtonElement,
  type JectsElement,
} from './index.js';
// Per-component subpath entry: pulls ONLY @jects/grid + the shared factory, no siblings.
import { registerGrid, JectsGridElement, gridElementDefinition } from './grid.js';
import type { Button } from '@jects/widgets';
import type { ButtonConfig, ButtonEvents } from '@jects/widgets';

type ButtonEl = JectsElement<Button, ButtonConfig, ButtonEvents>;

beforeAll(() => {
  // Idempotent: safe even though other suites in the same worker may have registered.
  register();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('@jects/elements smoke suite', () => {
  it('register() defines every <jects-*> tag and is idempotent', () => {
    expect(elementDefinitions).toHaveLength(18);
    for (const { tag } of elementDefinitions) {
      expect(customElements.get(tag)).toBeTypeOf('function');
    }
    // Second call must not throw (guarded by customElements.get).
    expect(() => register()).not.toThrow();
  });

  it('a per-component subpath entry registers only its own tag and matches the root class', () => {
    // The subpath helper defines exactly one element, and is idempotent.
    expect(gridElementDefinition.tag).toBe('jects-grid');
    expect(() => registerGrid()).not.toThrow();
    expect(customElements.get('jects-grid')).toBeTypeOf('function');
    // The class from the subpath entry is the same one the root barrel re-exports.
    expect(gridElementDefinition.ctor).toBe(JectsGridElement);
  });

  it('renders the engine .jects- DOM into the light-DOM element on connect', () => {
    const el = document.createElement('jects-button') as ButtonEl;
    el.config = { text: 'Click me' };
    document.body.appendChild(el);

    // No shadow root — the engine paints directly into the element (light DOM).
    expect(el.shadowRoot).toBeNull();
    expect(el.querySelector('.jects-btn')).not.toBeNull();
    expect(el.instance).not.toBeNull();
  });

  it('reads initial config from the JSON `config` attribute', () => {
    const el = document.createElement('jects-button') as ButtonEl;
    el.setAttribute('config', JSON.stringify({ text: 'From attr' }));
    document.body.appendChild(el);

    expect(el.querySelector('.jects-btn')?.textContent).toContain('From attr');
  });

  it('re-dispatches an engine event as a CustomEvent (Button click)', () => {
    const el = document.createElement('jects-button') as ButtonEl;
    el.config = { text: 'Go' };
    document.body.appendChild(el);

    const received: CustomEvent[] = [];
    el.addEventListener('click', (ev) => received.push(ev as CustomEvent));

    const btn = el.querySelector('.jects-btn') as HTMLElement;
    btn.click();

    // The bridged event is a CustomEvent whose detail carries the engine payload.
    const bridged = received.find(
      (ev): ev is CustomEvent => ev instanceof CustomEvent && !!(ev.detail as { button?: unknown })?.button,
    );
    expect(bridged).toBeDefined();
    expect((bridged!.detail as { button: unknown }).button).toBe(el.instance);
  });

  it('applies a config property change via update() WITHOUT remounting', () => {
    const el = document.createElement('jects-button') as ButtonEl;
    el.config = { text: 'One' };
    document.body.appendChild(el);

    const instanceBefore = el.instance;
    const rootBefore = el.querySelector('.jects-btn');
    expect(instanceBefore).not.toBeNull();
    const updateSpy = vi.spyOn(instanceBefore as Button, 'update');

    el.config = { text: 'Two' };

    // Same engine instance + same root => in-place update, not a remount.
    expect(el.instance).toBe(instanceBefore);
    expect(el.querySelector('.jects-btn')).toBe(rootBefore);
    expect(updateSpy).toHaveBeenCalled();
    expect((el.instance!.getConfig() as ButtonConfig).text).toBe('Two');
  });

  it('destroys the engine and clears the DOM on removal', () => {
    const el = document.createElement('jects-button') as ButtonEl;
    el.config = { text: 'Bye' };
    document.body.appendChild(el);

    const inst = el.instance as Button;
    expect(inst.isDestroyed).toBe(false);
    expect(el.querySelector('.jects-btn')).not.toBeNull();

    el.remove();

    expect(inst.isDestroyed).toBe(true);
    expect(el.instance).toBeNull();
    expect(el.querySelector('.jects-btn')).toBeNull();
  });

  it('reconnects after removal by rebuilding the engine', () => {
    const el = document.createElement('jects-button') as ButtonEl;
    el.config = { text: 'Again' };
    document.body.appendChild(el);
    const first = el.instance;
    el.remove();
    expect(el.instance).toBeNull();

    document.body.appendChild(el);
    expect(el.instance).not.toBeNull();
    expect(el.instance).not.toBe(first);
    expect(el.querySelector('.jects-btn')?.textContent).toContain('Again');
  });
});
