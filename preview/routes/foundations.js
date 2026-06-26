/** Route: foundations — token swatches (pure DOM/CSS, no @jects module). */
import { el } from '../shell/dom.js';
import { card } from '../shell/dom.js';
import { section } from '../shell/registry.js';

export function register() {
  section(
    'foundations',
    'Foundations',
    'The house token contract (--jects-*). Swatches read live CSS custom properties, so they restyle with the theme switcher and the primary / radius controls above.',
    (grid) => {
      const semantic = [
        'background', 'foreground', 'card', 'primary', 'secondary', 'muted',
        'accent', 'destructive', 'success', 'warning', 'border', 'ring',
      ];
      const cmyk = ['cmyk-cyan', 'cmyk-magenta', 'cmyk-yellow', 'cmyk-key',
        'cmyk-cyan-soft', 'cmyk-magenta-soft', 'cmyk-yellow-soft', 'cmyk-key-soft'];
      const ramp = ['data-1', 'data-2', 'data-3', 'data-4', 'data-5', 'data-6', 'data-7', 'data-8'];

      const swatchBlock = (names) => {
        const wrap = el('div', { class: 'g-swatches' });
        for (const name of names) {
          wrap.appendChild(
            el('div', { class: 'g-swatch' }, [
              el('div', { class: 'chip', style: `background:oklch(var(--jects-${name}))` }),
              el('div', { class: 'meta' }, [
                el('b', { text: name }),
                el('span', { text: `--jects-${name}` }),
              ]),
            ]),
          );
        }
        return wrap;
      };

      grid.appendChild(card('Semantic tokens', (h) => h.appendChild(swatchBlock(semantic)), { block: true }));
      grid.appendChild(card('Calm CMYK palette', (h) => h.appendChild(swatchBlock(cmyk)), { block: true }));
      grid.appendChild(card('Chart data ramp (data-1 … data-8)', (h) => h.appendChild(swatchBlock(ramp)), { block: true }));
    },
  );
}
