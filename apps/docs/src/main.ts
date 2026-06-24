/**
 * Minimal docs shell: imports @jects/theme + @jects/widgets, renders the Button
 * stories, and offers a light/dark theme toggle.
 */
import '@jects/theme/style.css';
import '@jects/theme/dark.css';
import '@jects/widgets/style.css';
import { Button, type ButtonConfig } from '@jects/widgets';
import { setTheme, getTheme } from '@jects/theme';

// Inline stories (kept local so the docs app depends only on the public API).
const stories: Array<{ name: string; config: ButtonConfig }> = [
  { name: 'Primary', config: { text: 'Primary', variant: 'primary' } },
  { name: 'Secondary', config: { text: 'Secondary', variant: 'secondary' } },
  { name: 'Destructive', config: { text: 'Delete', variant: 'destructive', icon: 'trash' } },
  { name: 'Outline', config: { text: 'Outline', variant: 'outline' } },
  { name: 'Ghost', config: { text: 'Ghost', variant: 'ghost' } },
  { name: 'Link', config: { text: 'Link', variant: 'link' } },
  { name: 'Icon start', config: { text: 'Search', icon: 'search' } },
  { name: 'Icon end', config: { text: 'Next', icon: 'chevron-right', iconAlign: 'end' } },
  { name: 'Icon only', config: { icon: 'plus', variant: 'outline' } },
  { name: 'Small', config: { text: 'Small', size: 'sm' } },
  { name: 'Large', config: { text: 'Large', size: 'lg' } },
  { name: 'Disabled', config: { text: 'Disabled', disabled: true } },
  { name: 'Loading', config: { text: 'Saving', loading: true } },
];

const app = document.getElementById('app')!;
app.innerHTML = `
  <header style="padding:1.5rem;border-bottom:1px solid oklch(var(--jects-border));display:flex;justify-content:space-between;align-items:center">
    <h1 style="margin:0;font-size:var(--jects-font-size-2xl)">Jects UI — Button</h1>
    <div id="toolbar"></div>
  </header>
  <main style="padding:1.5rem;display:flex;flex-direction:column;gap:1.5rem">
    <p style="color:oklch(var(--jects-muted-foreground));margin:0">
      Reference component. Imperative API: <code>new Button(el, { text, variant, size, ... })</code>.
    </p>
    <section id="grid" style="display:flex;flex-wrap:wrap;gap:1rem;align-items:center"></section>
  </main>
`;

// Theme toggle.
const toolbar = document.getElementById('toolbar')!;
new Button(toolbar, {
  text: 'Toggle dark',
  icon: 'check',
  variant: 'outline',
  onClick: () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'),
});

// Stories grid.
const grid = document.getElementById('grid')!;
for (const s of stories) {
  const cell = document.createElement('div');
  cell.style.cssText =
    'display:flex;flex-direction:column;gap:.5rem;align-items:center;min-width:120px';
  const label = document.createElement('span');
  label.textContent = s.name;
  label.style.cssText = 'font-size:var(--jects-font-size-xs);color:oklch(var(--jects-muted-foreground))';
  const host = document.createElement('div');
  cell.append(host, label);
  grid.appendChild(cell);
  new Button(host, s.config);
}
