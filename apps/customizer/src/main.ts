/**
 * Jects UI Theme Customizer.
 *
 * Live-binds the key Tier-2 tokens to controls that write inline CSS custom
 * properties on <html> (the same runtime contract @jects/theme.applyTheme uses),
 * renders a live preview (Buttons + a placeholder card), and exports the current
 * overrides as a downloadable theme.css.
 *
 * Default preset: the locked house style "Jects — Cool Zinc + Calm CMYK".
 */
import '@jects/theme/style.css';
import '@jects/theme/dark.css';
import '@jects/widgets/style.css';
import { Button } from '@jects/widgets';
import { setTheme, exportThemeCss, LIGHT_DEFAULTS } from '@jects/theme';
import { oklchToHex, hexToOklch } from './color.js';
import './customizer.css';

const root = document.documentElement;

interface ColorControl {
  token: string;
  label: string;
}
const colorControls: ColorControl[] = [
  { token: 'primary', label: 'Primary' },
  { token: 'background', label: 'Background' },
  { token: 'foreground', label: 'Foreground' },
  { token: 'accent', label: 'Accent' },
];

const app = document.getElementById('app')!;
app.innerHTML = `
  <header class="cz-header">
    <h1>Jects UI — Theme Customizer</h1>
    <p>House style: <strong>Cool Zinc + Calm CMYK</strong>. Edit tokens live; export a stylesheet.</p>
  </header>
  <div class="cz-layout">
    <aside class="cz-panel" id="controls"></aside>
    <main class="cz-preview" id="preview"></main>
  </div>
`;

// ---- controls -------------------------------------------------------------
const controls = document.getElementById('controls')!;

function readToken(token: string): string {
  const v = getComputedStyle(root).getPropertyValue(`--jects-${token}`).trim();
  return v || (LIGHT_DEFAULTS[token] ?? '0 0 0');
}

// Color pickers (token value stored as OKLCH triplet; picker shows hex).
for (const { token, label } of colorControls) {
  const wrap = document.createElement('div');
  wrap.className = 'cz-control';
  const id = `c-${token}`;
  wrap.innerHTML = `<label for="${id}">${label}</label>`;
  const input = document.createElement('input');
  input.type = 'color';
  input.id = id;
  input.value = oklchToHex(readToken(token));
  input.addEventListener('input', () => {
    root.style.setProperty(`--jects-${token}`, hexToOklch(input.value));
  });
  wrap.appendChild(input);
  controls.appendChild(wrap);
}

// Radius slider.
const radiusWrap = document.createElement('div');
radiusWrap.className = 'cz-control';
radiusWrap.innerHTML = `<label for="c-radius">Radius <span id="radius-val"></span></label>`;
const radius = document.createElement('input');
radius.type = 'range';
radius.id = 'c-radius';
radius.min = '0';
radius.max = '24';
radius.step = '1';
radius.value = '10';
const radiusVal = radiusWrap.querySelector('#radius-val')!;
const syncRadius = () => {
  root.style.setProperty('--jects-radius', `${radius.value}px`);
  radiusVal.textContent = `${radius.value}px`;
};
radius.addEventListener('input', syncRadius);
radiusWrap.appendChild(radius);
controls.appendChild(radiusWrap);
syncRadius();

// Base font size slider.
const fontWrap = document.createElement('div');
fontWrap.className = 'cz-control';
fontWrap.innerHTML = `<label for="c-font">Base font size <span id="font-val"></span></label>`;
const font = document.createElement('input');
font.type = 'range';
font.id = 'c-font';
font.min = '12';
font.max = '20';
font.step = '1';
font.value = '16';
const fontVal = fontWrap.querySelector('#font-val')!;
const syncFont = () => {
  root.style.setProperty('--jects-font-size-md', `${font.value}px`);
  fontVal.textContent = `${font.value}px`;
};
font.addEventListener('input', syncFont);
fontWrap.appendChild(font);
controls.appendChild(fontWrap);
syncFont();

// Spacing scale slider (scales space-4 used by buttons).
const spaceWrap = document.createElement('div');
spaceWrap.className = 'cz-control';
spaceWrap.innerHTML = `<label for="c-space">Padding scale <span id="space-val"></span></label>`;
const space = document.createElement('input');
space.type = 'range';
space.id = 'c-space';
space.min = '0.5';
space.max = '1.5';
space.step = '0.05';
space.value = '1';
const spaceVal = spaceWrap.querySelector('#space-val')!;
const syncSpace = () => {
  root.style.setProperty('--jects-space-4', `${Number(space.value)}rem`);
  spaceVal.textContent = `${space.value}×`;
};
space.addEventListener('input', syncSpace);
spaceWrap.appendChild(space);
controls.appendChild(spaceWrap);
syncSpace();

// Theme toggle.
const themeWrap = document.createElement('div');
themeWrap.className = 'cz-control';
themeWrap.innerHTML = `<label>Theme</label>`;
const themeSel = document.createElement('select');
for (const t of ['light', 'dark', 'light-hc', 'dark-hc', 'stockholm', 'material']) {
  const opt = document.createElement('option');
  opt.value = t;
  opt.textContent = t;
  themeSel.appendChild(opt);
}
themeSel.addEventListener('change', () => setTheme(themeSel.value as never));
themeWrap.appendChild(themeSel);
controls.appendChild(themeWrap);

// Export button.
const exportBtnHost = document.createElement('div');
exportBtnHost.className = 'cz-control';
controls.appendChild(exportBtnHost);
new Button(exportBtnHost, {
  text: 'Export theme.css',
  icon: 'arrow-down',
  variant: 'primary',
  onClick: () => downloadThemeCss(),
});

function downloadThemeCss(): void {
  const names = Object.keys(LIGHT_DEFAULTS).concat(['radius', 'font-size-md', 'space-4']);
  const css = exportThemeCss(root, names);
  const blob = new Blob([css], { type: 'text/css' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'theme.css';
  a.click();
  URL.revokeObjectURL(url);
}

// ---- preview --------------------------------------------------------------
const preview = document.getElementById('preview')!;

const variantsRow = document.createElement('div');
variantsRow.className = 'cz-row';
preview.appendChild(variantsRow);
for (const variant of ['primary', 'secondary', 'destructive', 'outline', 'ghost', 'link'] as const) {
  new Button(variantsRow, { text: variant, variant });
}

const sizeRow = document.createElement('div');
sizeRow.className = 'cz-row';
preview.appendChild(sizeRow);
for (const size of ['sm', 'md', 'lg'] as const) {
  new Button(sizeRow, { text: `Size ${size}`, size, icon: 'check' });
}

// Placeholder card.
const card = document.createElement('div');
card.className = 'cz-card';
card.innerHTML = `
  <h3>Card preview</h3>
  <p>This placeholder card uses card / border / muted-foreground tokens so you can see
  surfaces and text recolor live.</p>
`;
const cardActions = document.createElement('div');
cardActions.className = 'cz-row';
new Button(cardActions, { text: 'Confirm', variant: 'primary' });
new Button(cardActions, { text: 'Cancel', variant: 'ghost' });
card.appendChild(cardActions);
preview.appendChild(card);
