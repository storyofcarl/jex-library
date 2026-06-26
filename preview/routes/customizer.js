/** Route: customizer — the live, exportable theme control surface. */
import { el, card } from '../shell/dom.js';
import { section } from '../shell/registry.js';
import { setTheme, applyTheme, exportThemeCss, clearTheme } from '@jects/theme';
import { hexToOklchTriplet } from '../shell/nav.js';
import { months, colors, genGridRows } from '../shell/data.js';
import {
  Button, Badge, Avatar, TextField, Select, Switch, Slider, Grid, Chart,
} from '../shell/registry.js';

const CZ_SEMANTIC = [
  ['background', 'Background', '#ffffff'],
  ['foreground', 'Foreground', '#18181b'],
  ['card', 'Card', '#ffffff'],
  ['card-foreground', 'Card fg', '#18181b'],
  ['popover', 'Popover', '#ffffff'],
  ['popover-foreground', 'Popover fg', '#18181b'],
  ['primary', 'Primary', '#3b3b46'],
  ['primary-foreground', 'Primary fg', '#fafafa'],
  ['secondary', 'Secondary', '#f4f4f5'],
  ['secondary-foreground', 'Secondary fg', '#3b3b46'],
  ['muted', 'Muted', '#f4f4f5'],
  ['muted-foreground', 'Muted fg', '#71717a'],
  ['accent', 'Accent', '#8b5cf6'],
  ['accent-foreground', 'Accent fg', '#3b3b46'],
  ['destructive', 'Destructive', '#dc2626'],
  ['destructive-foreground', 'Destructive fg', '#fafafa'],
  ['success', 'Success', '#16a34a'],
  ['success-foreground', 'Success fg', '#fafafa'],
  ['warning', 'Warning', '#d4a72c'],
  ['warning-foreground', 'Warning fg', '#3b3b46'],
  ['border', 'Border', '#e4e4e7'],
  ['input', 'Input', '#e4e4e7'],
  ['ring', 'Ring', '#a1a1aa'],
];

const CZ_DATA = [
  ['data-1', 'Data 1', '#1f9fc7'], ['data-2', 'Data 2', '#c74f8a'],
  ['data-3', 'Data 3', '#d4a72c'], ['data-4', 'Data 4', '#3b3b46'],
  ['data-5', 'Data 5', '#3a7bd5'], ['data-6', 'Data 6', '#a64dad'],
  ['data-7', 'Data 7', '#7ab648'], ['data-8', 'Data 8', '#4a4a55'],
];
const CZ_CMYK = [
  ['cmyk-cyan', 'Cyan', '#1f9fc7'], ['cmyk-magenta', 'Magenta', '#c74f8a'],
  ['cmyk-yellow', 'Yellow', '#d4a72c'], ['cmyk-key', 'Key', '#3b3b46'],
];

const CZ_FONTS = [
  { value: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', label: 'System sans' },
  { value: 'Georgia, "Times New Roman", Times, serif', label: 'Serif' },
  { value: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace', label: 'Monospace' },
  { value: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif', label: 'Geometric' },
];
const CZ_MONO_FONTS = [
  { value: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace', label: 'System mono' },
  { value: '"Courier New", Courier, monospace', label: 'Courier' },
  { value: '"Cascadia Code", "Fira Code", ui-monospace, monospace', label: 'Cascadia / Fira' },
];

/* Scalar control defaults (the values per-section Reset restores). */
const CZ_DEFAULTS = {
  base: 'light',
  radius: 10,        // px
  fontFamily: CZ_FONTS[0].value,
  fontFamilyMono: CZ_MONO_FONTS[0].value,
  fontSize: 16,      // px (base font-size-md)
  weightNormal: 400, weightMedium: 500, weightSemibold: 600, weightBold: 700,
  lineHeight: 1.5,
  letterSpacing: 0,  // em x100 (slider in /100 em)
  spacing: 4,        // px step (space-1)
  density: 1,        // scalar
  borderWidth: 1,    // px
  ringWidth: 2,      // px
  ringOffset: 2,     // px
  borderColor: '#e4e4e7',
  ringColor: '#a1a1aa',
  tableHeaderBg: '#f4f4f5',
  tableRowStripe: '#f4f4f5',
  tableRowHover: '#ede9fe',
  tableBorder: '#e4e4e7',
  tableCellPadX: 12, // px
  shadow: 'md',
  motion: 'normal',
};

const CZ_EXPORT_TOKENS = [
  ...CZ_SEMANTIC.map((c) => c[0]),
  ...CZ_DATA.map((c) => c[0]),
  ...CZ_CMYK.map((c) => c[0]),
  'cmyk-cyan-soft', 'cmyk-magenta-soft', 'cmyk-yellow-soft', 'cmyk-key-soft',
  'radius', 'radius-sm', 'radius-md', 'radius-lg', 'radius-xl',
  'font-family', 'font-family-mono',
  'font-size-xs', 'font-size-sm', 'font-size-md', 'font-size-lg', 'font-size-xl', 'font-size-2xl',
  'font-weight-normal', 'font-weight-medium', 'font-weight-semibold', 'font-weight-bold',
  'line-height', 'letter-spacing',
  'space-1', 'space-2', 'space-3', 'space-4', 'space-5', 'space-6',
  'space-7', 'space-8', 'space-9', 'space-10', 'space-11', 'space-12',
  'density', 'control-height', 'control-padding-x', 'control-padding-y',
  'border-width', 'ring-width', 'ring-offset',
  'table-header-bg', 'table-row-stripe', 'table-row-hover', 'table-border',
  'table-cell-padding-x', 'table-cell-padding-y', 'table-row-height',
  'shadow-sm', 'shadow-md', 'shadow-lg',
  'duration-fast', 'duration-normal', 'duration-slow',
];

/* WCAG relative-luminance contrast on hex pairs (sRGB). */
function czContrastRatio(hexA, hexB) {
  const lum = (hex) => {
    const m = hex.replace('#', '');
    if (m.length < 6) return null;
    const ch = [0, 2, 4].map((i) => {
      const c = parseInt(m.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const la = lum(hexA), lb = lum(hexB);
  if (la == null || lb == null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function register() {
  section(
    'customizer',
    'Theme customizer',
    'A full design-system control surface. Edit colors, typography, spacing, density, borders, outlines, tables, elevation and motion across collapsible groups — every real component below restyles live from one token set. Import a theme, check WCAG contrast, share a link, or download a ready-to-ship theme.css.',
    (grid) => {
      const wrap = el('div', { class: 'g-customizer' });

      /* The single preview SCOPE. setTheme()/applyTheme() target this element. */
      const scope = el('div', { class: 'g-cz-preview jects-scope', 'data-jects-scope': '', 'data-cz-scope': '' });
      setTheme('light', scope);

      /* Generated-CSS code area (declared early so handlers can refresh it). */
      const code = el('textarea', { class: 'g-cz-code', readonly: 'readonly', spellcheck: 'false', 'aria-label': 'Generated theme.css', 'data-cz-code': '' });

      /* Live override registry — token name → raw value (for share-URL + import). */
      const overrides = {};
      const setOverride = (name, value) => { overrides[name] = value; };

      /* Per-section reset registry. */
      const sectionResetters = {};

      let updateContrast = () => {};
      let updateShareUrl = () => {};
      let suspendShare = false;
      const refreshExport = () => {
        code.value = exportThemeCss(scope, CZ_EXPORT_TOKENS, ':root');
        updateContrast();
        if (!suspendShare) updateShareUrl();
      };

      /* apply: write tokens to the scope, record overrides, refresh side panels. */
      const apply = (map) => {
        applyTheme(scope, map);
        for (const k in map) setOverride(k, map[k]);
        refreshExport();
      };

      /* ───────────────────────── collapsible group factory ──────────────── */
      const groups = []; // {id, body, titleEl, rows:[{label, node}]}
      const makeGroup = (id, title, { open = false } = {}) => {
        const body = el('div', { class: 'g-cz-group-body' });
        const reset = el('button', { type: 'button', class: 'g-cz-secreset', title: 'Reset this section', 'aria-label': 'Reset ' + title, text: 'Reset' });
        reset.addEventListener('click', (e) => {
          e.stopPropagation();
          const fn = sectionResetters[id];
          if (fn) fn();
        });
        const caret = el('span', { class: 'g-cz-caret', 'aria-hidden': 'true', text: '▸' });
        const titleSpan = el('span', { class: 'g-cz-group-title', text: title });
        const head = el('button', { type: 'button', class: 'g-cz-group-hd', 'aria-expanded': open ? 'true' : 'false', 'data-cz-group': id }, [caret, titleSpan]);
        const headWrap = el('div', { class: 'g-cz-group-headwrap' }, [head, reset]);
        head.addEventListener('click', () => {
          const isOpen = head.getAttribute('aria-expanded') === 'true';
          head.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
        });
        const groupEl = el('div', { class: 'g-cz-group', 'data-cz-groupwrap': id }, [headWrap, body]);
        if (open) head.setAttribute('aria-expanded', 'true');
        const rec = { id, title, body, head, titleSpan, rows: [], groupEl };
        groups.push(rec);
        return rec;
      };

      /* — control factories scoped to a group's body — */
      const rowIn = (g, label, inputEl) => {
        const node = el('div', { class: 'g-cz-row', 'data-cz-ctl': (label || '').toLowerCase() }, [
          el('label', { class: 'g-cz-label', text: label }),
          inputEl,
        ]);
        g.body.appendChild(node);
        g.rows.push({ label: (label || '').toLowerCase(), node });
        return node;
      };

      const colorControl = (g, token, label, defHex, mode = 'triplet') => {
        const inp = el('input', { type: 'color', class: 'g-cz-color', value: defHex, 'aria-label': label, 'data-cz-color': token });
        const hex = el('input', { type: 'text', class: 'g-cz-hex', value: defHex, spellcheck: 'false', maxlength: '7', 'aria-label': label + ' hex' });
        let lastHex = defHex;
        const toToken = (h) => (mode === 'full' ? 'oklch(' + hexToOklchTriplet(h) + ')' : hexToOklchTriplet(h));
        const push = (h) => { lastHex = h; apply({ [token]: toToken(h) }); };
        inp.addEventListener('input', () => { hex.value = inp.value; push(inp.value); });
        hex.addEventListener('input', () => {
          let v = hex.value.trim(); if (v && v[0] !== '#') v = '#' + v;
          if (/^#[0-9a-fA-F]{3}$/.test(v)) v = '#' + v.slice(1).split('').map((c) => c + c).join('');
          if (/^#[0-9a-fA-F]{6}$/.test(v)) { inp.value = v; push(v); }
        });
        const setHex = (v) => { inp.value = v; hex.value = v; lastHex = v; };
        rowIn(g, label, el('span', { class: 'g-cz-colorwrap' }, [inp, hex]));
        return { token, setHex, getHex: () => lastHex, defHex };
      };

      const rangeControl = (g, label, def, min, max, step, applyFn, unit, fmt) => {
        const out = el('span', { class: 'g-cz-out' });
        const inp = el('input', { type: 'range', class: 'g-cz-range', min: String(min), max: String(max), step: String(step), value: String(def), 'aria-label': label });
        const sync = () => { out.textContent = (fmt ? fmt(inp.value) : inp.value) + (unit || ''); };
        inp.addEventListener('input', () => { applyFn(inp.value); sync(); });
        sync();
        rowIn(g, label, el('span', { class: 'g-cz-rangewrap' }, [inp, out]));
        return { inp, sync, def };
      };

      const selectControl = (g, label, options, def, onChange) => {
        const sel = el('select', { class: 'g-cz-select', 'aria-label': label });
        options.forEach((o) => sel.appendChild(el('option', { value: o.value, text: o.label })));
        sel.value = def;
        sel.addEventListener('change', () => onChange(sel.value));
        rowIn(g, label, sel);
        return sel;
      };

      const segControl = (g, label, options, def, onChange, attr) => {
        const seg = el('div', { class: 'g-seg g-cz-seg' });
        options.forEach(([value, lbl]) => {
          const b = el('button', { type: 'button', text: lbl, 'aria-pressed': value === def ? 'true' : 'false' });
          if (attr) b.setAttribute(attr, value);
          b.addEventListener('click', () => {
            seg.querySelectorAll('button').forEach((n) => n.setAttribute('aria-pressed', 'false'));
            b.setAttribute('aria-pressed', 'true');
            onChange(value);
          });
          seg.appendChild(b);
        });
        const setActive = (value) => seg.querySelectorAll('button').forEach((n, i) =>
          n.setAttribute('aria-pressed', options[i][0] === value ? 'true' : 'false'));
        rowIn(g, label, seg);
        return { seg, setActive };
      };

      const clearTokens = (names) => { clearTheme(scope, names); names.forEach((n) => { delete overrides[n]; }); };

      /* ════════════════════ GROUP 1 — Base & presets ═════════════════════ */
      const gBase = makeGroup('base', 'Base & presets', { open: true });
      const BASES = [['light', 'Light'], ['dark', 'Dark'], ['light-hc', 'High contrast']];
      let currentBase = 'light';
      const baseSeg = segControl(gBase, 'Base', BASES, 'light', (v) => {
        currentBase = v; setTheme(v, scope); refreshExport();
      }, 'data-cz-base');

      const PRESETS = {
        bootstrap: { primary: '#0d6efd', accent: '#6610f2', radius: 6, label: 'Bootstrap' },
        refined: { primary: '#6d28d9', accent: '#db2777', radius: 14, label: 'Refined' },
        corporate: { primary: '#1e3a5f', accent: '#0891b2', radius: 4, label: 'Corporate' },
      };
      const presetSel = el('select', { class: 'g-cz-select', 'aria-label': 'Start from preset' });
      presetSel.appendChild(el('option', { value: '', text: 'Start from preset…' }));
      Object.entries(PRESETS).forEach(([k, p]) => presetSel.appendChild(el('option', { value: k, text: p.label })));
      presetSel.addEventListener('change', () => {
        const p = PRESETS[presetSel.value];
        if (!p) return;
        apply({ primary: hexToOklchTriplet(p.primary), ring: hexToOklchTriplet(p.primary),
                accent: hexToOklchTriplet(p.accent), radius: p.radius + 'px' });
        presetSel.value = '';
      });
      rowIn(gBase, 'Preset', presetSel);

      // Import — parse pasted theme.css / token list and apply.
      const importTa = el('textarea', { class: 'g-cz-import', spellcheck: 'false', placeholder: 'Paste theme.css or --jects-* overrides here…', 'aria-label': 'Import tokens', 'data-cz-import': '' });
      const importNote = el('span', { class: 'g-cz-note', 'data-cz-import-note': '' });
      const importBtn = el('button', { type: 'button', class: 'g-cz-btn', text: 'Import', 'data-cz-import-apply': '' });
      importBtn.addEventListener('click', () => {
        const text = importTa.value;
        const re = /--jects-([a-z0-9-]+)\s*:\s*([^;}\n]+)/gi;
        let m, count = 0; const map = {};
        while ((m = re.exec(text)) !== null) { map[m[1]] = m[2].trim(); count++; }
        if (count) {
          apply(map);
          // reflect imported color swatches where we track them
          syncColorSwatchesFromScope();
          importNote.textContent = 'Imported ' + count + ' token' + (count === 1 ? '' : 's');
        } else {
          importNote.textContent = 'No --jects-* tokens found';
        }
        setTimeout(() => { importNote.textContent = ''; }, 2600);
      });
      const importRow = el('div', { class: 'g-cz-row g-cz-row--block' }, [
        el('label', { class: 'g-cz-label', text: 'Import' }),
        el('div', { class: 'g-cz-importwrap' }, [importTa, el('div', { class: 'g-cz-cluster' }, [importBtn, importNote])]),
      ]);
      gBase.body.appendChild(importRow);
      gBase.rows.push({ label: 'import', node: importRow });

      sectionResetters.base = () => {
        clearTokens(['primary', 'ring', 'accent', 'radius']);
        currentBase = 'light'; setTheme('light', scope); baseSeg.setActive('light');
        refreshExport();
      };

      /* ════════════════ GROUP 2 — Brand & semantic colors ════════════════ */
      const gColors = makeGroup('colors', 'Brand & semantic colors');
      const colorCtls = []; // for import-sync + reset
      CZ_SEMANTIC.forEach(([token, label, defHex]) => {
        const c = colorControl(gColors, token, label, defHex, 'triplet');
        colorCtls.push(c);
      });
      sectionResetters.colors = () => {
        clearTokens(CZ_SEMANTIC.map((c) => c[0]));
        colorCtls.forEach((c) => c.setHex(c.defHex));
        refreshExport();
      };

      /* ════════════════ GROUP 3 — Data & chart ramps ═════════════════════ */
      const gData = makeGroup('data', 'Data & chart ramps');
      const dataCtls = [];
      CZ_DATA.forEach(([t, l, d]) => dataCtls.push(colorControl(gData, t, l, d, 'triplet')));
      CZ_CMYK.forEach(([t, l, d]) => dataCtls.push(colorControl(gData, t, l, d, 'triplet')));
      sectionResetters.data = () => {
        clearTokens([...CZ_DATA, ...CZ_CMYK].map((c) => c[0]));
        dataCtls.forEach((c) => c.setHex(c.defHex));
        refreshExport();
      };

      /* ════════════════════════ GROUP 4 — Typography ═════════════════════ */
      const gType = makeGroup('typography', 'Typography');
      const fontSel = selectControl(gType, 'Font family', CZ_FONTS, CZ_DEFAULTS.fontFamily, (v) => apply({ 'font-family': v }));
      const monoSel = selectControl(gType, 'Mono family', CZ_MONO_FONTS, CZ_DEFAULTS.fontFamilyMono, (v) => apply({ 'font-family-mono': v }));
      const FS_RATIOS = { 'font-size-xs': 0.75, 'font-size-sm': 0.875, 'font-size-md': 1, 'font-size-lg': 1.125, 'font-size-xl': 1.25, 'font-size-2xl': 1.5 };
      const fontSizeCtl = rangeControl(gType, 'Base size', CZ_DEFAULTS.fontSize, 12, 20, 1, (v) => {
        const base = Number(v) || 16; const o = {};
        for (const k in FS_RATIOS) o[k] = +(FS_RATIOS[k] * base).toFixed(2) + 'px';
        apply(o);
      }, 'px');
      const wNormal = rangeControl(gType, 'Weight normal', CZ_DEFAULTS.weightNormal, 100, 900, 50, (v) => apply({ 'font-weight-normal': v }));
      const wMedium = rangeControl(gType, 'Weight medium', CZ_DEFAULTS.weightMedium, 100, 900, 50, (v) => apply({ 'font-weight-medium': v }));
      const wSemibold = rangeControl(gType, 'Weight semibold', CZ_DEFAULTS.weightSemibold, 100, 900, 50, (v) => apply({ 'font-weight-semibold': v }));
      const wBold = rangeControl(gType, 'Weight bold', CZ_DEFAULTS.weightBold, 100, 900, 50, (v) => apply({ 'font-weight-bold': v }));
      const lhCtl = rangeControl(gType, 'Line height', CZ_DEFAULTS.lineHeight, 1, 2.2, 0.05, (v) => apply({ 'line-height': v }), '', (v) => Number(v).toFixed(2));
      const lsCtl = rangeControl(gType, 'Letter spacing', CZ_DEFAULTS.letterSpacing, -5, 15, 1, (v) => apply({ 'letter-spacing': (Number(v) / 100) + 'em' }), 'em', (v) => (Number(v) / 100).toFixed(2));
      sectionResetters.typography = () => {
        clearTokens([...Object.keys(FS_RATIOS), 'font-family', 'font-family-mono',
          'font-weight-normal', 'font-weight-medium', 'font-weight-semibold', 'font-weight-bold',
          'line-height', 'letter-spacing']);
        fontSel.value = CZ_DEFAULTS.fontFamily; monoSel.value = CZ_DEFAULTS.fontFamilyMono;
        [fontSizeCtl, wNormal, wMedium, wSemibold, wBold, lhCtl, lsCtl].forEach((c) => { c.inp.value = String(c.def); c.sync(); });
        refreshExport();
      };

      /* ═══════════════════ GROUP 5 — Spacing & density ═══════════════════ */
      const gSpace = makeGroup('spacing', 'Spacing & density');
      const applySpacing = (stepPx) => { const map = {}; for (let i = 1; i <= 12; i++) map['space-' + i] = (i * Number(stepPx)) + 'px'; apply(map); };
      const spacingCtl = rangeControl(gSpace, 'Spacing step', CZ_DEFAULTS.spacing, 2, 10, 1, (v) => applySpacing(v), 'px');
      const DENSITY = [['0.85', 'Compact'], ['1', 'Cozy'], ['1.15', 'Comfortable']];
      const densitySeg = segControl(gSpace, 'Density', DENSITY, '1', (v) => apply({ density: v }), 'data-cz-density');
      sectionResetters.spacing = () => {
        const names = []; for (let i = 1; i <= 12; i++) names.push('space-' + i);
        clearTokens([...names, 'density']);
        spacingCtl.inp.value = String(spacingCtl.def); spacingCtl.sync();
        densitySeg.setActive('1');
        refreshExport();
      };

      /* ═══════════════════════════ GROUP 6 — Radius ══════════════════════ */
      const gRadius = makeGroup('radius', 'Radius');
      const radiusCtl = rangeControl(gRadius, 'Radius', CZ_DEFAULTS.radius, 0, 24, 1, (v) => apply({ radius: v + 'px' }), 'px');
      sectionResetters.radius = () => {
        clearTokens(['radius']); radiusCtl.inp.value = String(radiusCtl.def); radiusCtl.sync(); refreshExport();
      };

      /* ══════════════════ GROUP 7 — Borders & outlines ═══════════════════ */
      const gBorders = makeGroup('borders', 'Borders & outlines');
      const borderWCtl = rangeControl(gBorders, 'Border width', CZ_DEFAULTS.borderWidth, 0, 6, 1, (v) => apply({ 'border-width': v + 'px' }), 'px');
      const borderColorCtl = colorControl(gBorders, 'border', 'Border color', CZ_DEFAULTS.borderColor, 'triplet');
      const ringColorCtl = colorControl(gBorders, 'ring', 'Ring color', CZ_DEFAULTS.ringColor, 'triplet');
      const ringWCtl = rangeControl(gBorders, 'Ring width', CZ_DEFAULTS.ringWidth, 0, 8, 1, (v) => apply({ 'ring-width': v + 'px' }), 'px');
      const ringOCtl = rangeControl(gBorders, 'Ring offset', CZ_DEFAULTS.ringOffset, 0, 8, 1, (v) => apply({ 'ring-offset': v + 'px' }), 'px');
      sectionResetters.borders = () => {
        clearTokens(['border-width', 'ring-width', 'ring-offset', 'border', 'ring']);
        [borderWCtl, ringWCtl, ringOCtl].forEach((c) => { c.inp.value = String(c.def); c.sync(); });
        borderColorCtl.setHex(borderColorCtl.defHex); ringColorCtl.setHex(ringColorCtl.defHex);
        refreshExport();
      };

      /* ════════════════════════════ GROUP 8 — Tables ════════════════════ */
      const gTables = makeGroup('tables', 'Tables');
      const tHeaderCtl = colorControl(gTables, 'table-header-bg', 'Header bg', CZ_DEFAULTS.tableHeaderBg, 'full');
      const tStripeCtl = colorControl(gTables, 'table-row-stripe', 'Row stripe', CZ_DEFAULTS.tableRowStripe, 'full');
      const tHoverCtl = colorControl(gTables, 'table-row-hover', 'Row hover', CZ_DEFAULTS.tableRowHover, 'full');
      const tBorderCtl = colorControl(gTables, 'table-border', 'Grid border', CZ_DEFAULTS.tableBorder, 'full');
      const tPadCtl = rangeControl(gTables, 'Cell padding', CZ_DEFAULTS.tableCellPadX, 2, 28, 1, (v) => apply({ 'table-cell-padding-x': v + 'px' }), 'px');
      sectionResetters.tables = () => {
        clearTokens(['table-header-bg', 'table-row-stripe', 'table-row-hover', 'table-border', 'table-cell-padding-x']);
        [tHeaderCtl, tStripeCtl, tHoverCtl, tBorderCtl].forEach((c) => c.setHex(c.defHex));
        tPadCtl.inp.value = String(tPadCtl.def); tPadCtl.sync();
        refreshExport();
      };

      /* ══════════════════════════ GROUP 9 — Elevation ═══════════════════ */
      const gElev = makeGroup('elevation', 'Elevation');
      const SHADOWS = {
        sm: { sm: '0 1px 1px 0 oklch(0.145 0.006 272 / 0.04)', md: '0 1px 2px 0 oklch(0.145 0.006 272 / 0.06)', lg: '0 2px 4px -1px oklch(0.145 0.006 272 / 0.08)' },
        md: null, // null = clear (use base defaults)
        lg: { sm: '0 2px 4px 0 oklch(0.145 0.006 272 / 0.08)', md: '0 8px 12px -2px oklch(0.145 0.006 272 / 0.14), 0 4px 6px -3px oklch(0.145 0.006 272 / 0.12)', lg: '0 20px 28px -6px oklch(0.145 0.006 272 / 0.18), 0 8px 12px -6px oklch(0.145 0.006 272 / 0.14)' },
      };
      const elevSeg = segControl(gElev, 'Shadow', [['sm', 'Subtle'], ['md', 'Default'], ['lg', 'Dramatic']], 'md', (v) => {
        if (v === 'md') { clearTokens(['shadow-sm', 'shadow-md', 'shadow-lg']); refreshExport(); }
        else { const s = SHADOWS[v]; apply({ 'shadow-sm': s.sm, 'shadow-md': s.md, 'shadow-lg': s.lg }); }
      }, 'data-cz-shadow');
      sectionResetters.elevation = () => { clearTokens(['shadow-sm', 'shadow-md', 'shadow-lg']); elevSeg.setActive('md'); refreshExport(); };

      /* ════════════════════════════ GROUP 10 — Motion ═══════════════════ */
      const gMotion = makeGroup('motion', 'Motion');
      const MOTION = {
        fast: { fast: '60ms', normal: '100ms', slow: '160ms' },
        normal: null,
        slow: { fast: '220ms', normal: '360ms', slow: '560ms' },
      };
      const motionSeg = segControl(gMotion, 'Duration', [['fast', 'Fast'], ['normal', 'Default'], ['slow', 'Slow']], 'normal', (v) => {
        if (v === 'normal') { clearTokens(['duration-fast', 'duration-normal', 'duration-slow']); refreshExport(); }
        else { const m = MOTION[v]; apply({ 'duration-fast': m.fast, 'duration-normal': m.normal, 'duration-slow': m.slow }); }
      }, 'data-cz-motion');
      sectionResetters.motion = () => { clearTokens(['duration-fast', 'duration-normal', 'duration-slow']); motionSeg.setActive('normal'); refreshExport(); };

      /* ───── sync swatches from the scope's computed colors (after import) ── */
      function hexFromToken(token) {
        // best-effort: read computed oklch triplet → not trivially back to hex,
        // so we leave swatches as-is; import still applies tokens live.
        void token;
      }
      function syncColorSwatchesFromScope() { void hexFromToken; }

      /* ───────────────────────── search / filter ────────────────────────── */
      const search = el('input', { type: 'search', class: 'g-cz-search', placeholder: 'Filter tokens…', 'aria-label': 'Filter tokens', 'data-cz-search': '' });
      const applyFilter = () => {
        const q = search.value.trim().toLowerCase();
        groups.forEach((g) => {
          if (!q) {
            g.groupEl.style.display = '';
            g.rows.forEach((r) => { r.node.style.display = ''; });
            return;
          }
          const titleHit = g.title.toLowerCase().includes(q);
          let any = false;
          g.rows.forEach((r) => {
            const hit = titleHit || r.label.includes(q);
            r.node.style.display = hit ? '' : 'none';
            if (hit) any = true;
          });
          g.groupEl.style.display = any ? '' : 'none';
          if (any) g.head.setAttribute('aria-expanded', 'true');
        });
      };
      search.addEventListener('input', applyFilter);

      /* ───────────────────────── controls panel assembly ────────────────── */
      const controlsInner = el('div', { class: 'g-cz-controls' });
      groups.forEach((g) => controlsInner.appendChild(g.groupEl));

      const globalReset = el('button', { type: 'button', class: 'g-cz-btn', text: 'Reset all', 'data-cz-reset': '' });
      globalReset.addEventListener('click', () => {
        clearTheme(scope, CZ_EXPORT_TOKENS);
        for (const k in overrides) delete overrides[k];
        setTheme('light', scope); currentBase = 'light';
        Object.values(sectionResetters).forEach((fn) => fn());
        baseSeg.setActive('light');
        refreshExport();
      });

      const controlsCard = el('div', { class: 'g-cz-panel' }, [
        el('div', { class: 'g-cz-panel-hd', text: 'Tokens' }),
        search,
        controlsInner,
        el('div', { class: 'g-cz-cluster', style: 'margin-top:.75rem' }, [globalReset]),
      ]);

      /* ═══════════════════ live multi-component preview ══════════════════ */
      const focusSel = el('select', { class: 'g-cz-select g-cz-focus', 'aria-label': 'Focus preview component', 'data-cz-focus': '' });
      [['all', 'Show all'], ['controls', 'Controls only'], ['grid', 'Grid only'], ['chart', 'Chart only']]
        .forEach(([v, l]) => focusSel.appendChild(el('option', { value: v, text: l })));

      const pv = el('div', { class: 'g-cz-pvgrid' });

      // Buttons + badges
      const btnCard = el('div', { class: 'g-cz-card', 'data-cz-card': 'controls' });
      btnCard.appendChild(el('div', { class: 'g-cz-card-hd', text: 'Buttons & badges' }));
      const btnRow = el('div', { class: 'g-cz-cluster', 'data-cz-buttons': '' });
      new Button(btnRow, { text: 'Primary', variant: 'primary' });
      new Button(btnRow, { text: 'Secondary', variant: 'secondary' });
      new Button(btnRow, { text: 'Outline', variant: 'outline' });
      new Button(btnRow, { text: 'Delete', variant: 'destructive', icon: 'trash' });
      new Button(btnRow, { text: 'Ghost', variant: 'ghost' });
      btnCard.appendChild(btnRow);
      const badgeRow = el('div', { class: 'g-cz-cluster' });
      new Badge(badgeRow, { text: 'Active', variant: 'success', dot: true });
      new Badge(badgeRow, { text: 'Cyan', variant: 'cyan' });
      new Badge(badgeRow, { text: 'Warning', variant: 'warning' });
      new Avatar(badgeRow, { name: 'Ada Lovelace' });
      btnCard.appendChild(badgeRow);
      pv.appendChild(btnCard);

      // Fields cluster
      const formCard = el('div', { class: 'g-cz-card', 'data-cz-card': 'controls' });
      formCard.appendChild(el('div', { class: 'g-cz-card-hd', text: 'Form fields' }));
      const fieldHost = el('div', { class: 'g-cz-fields' });
      new TextField(fieldHost, { label: 'Email', value: 'jane@example.com', inputType: 'email', clearable: true });
      new Select(fieldHost, { options: colors, placeholder: 'Choose a color', ariaLabel: 'Color', value: 'blue' });
      new Switch(fieldHost, { label: 'Notifications', checked: true });
      new Slider(fieldHost, { min: 0, max: 100, value: 60, label: 'Budget' });
      formCard.appendChild(fieldHost);
      pv.appendChild(formCard);

      // Surfaces card — exercises card/popover/muted + shadow tokens.
      const surfCard = el('div', { class: 'g-cz-card', 'data-cz-card': 'controls' });
      surfCard.appendChild(el('div', { class: 'g-cz-card-hd', text: 'Surfaces & elevation' }));
      const surfRow = el('div', { class: 'g-cz-surfrow' }, [
        el('div', { class: 'g-cz-surf g-cz-surf--sm', text: 'shadow-sm' }),
        el('div', { class: 'g-cz-surf g-cz-surf--md', text: 'shadow-md' }),
        el('div', { class: 'g-cz-surf g-cz-surf--lg', text: 'shadow-lg' }),
      ]);
      surfCard.appendChild(surfRow);
      pv.appendChild(surfCard);

      // Grid
      const gridCard = el('div', { class: 'g-cz-card', 'data-cz-card': 'grid' });
      gridCard.appendChild(el('div', { class: 'g-cz-card-hd', text: 'Grid' }));
      const gridHost = el('div', { class: 'g-cz-gridhost' });
      gridCard.appendChild(gridHost);
      pv.appendChild(gridCard);

      // Chart
      const chartCard = el('div', { class: 'g-cz-card', 'data-cz-card': 'chart' });
      chartCard.appendChild(el('div', { class: 'g-cz-card-hd', text: 'Chart' }));
      const chartHost = el('div', { class: 'g-cz-charthost' });
      chartCard.appendChild(chartHost);
      pv.appendChild(chartCard);

      scope.appendChild(pv);

      focusSel.addEventListener('change', () => {
        const v = focusSel.value;
        pv.querySelectorAll('[data-cz-card]').forEach((c) => {
          c.style.display = (v === 'all' || c.getAttribute('data-cz-card') === v) ? '' : 'none';
        });
      });

      const previewCard = el('div', { class: 'g-cz-panel g-cz-previewpanel' }, [
        el('div', { class: 'g-cz-panel-hd g-cz-pvhd' }, [
          el('span', { text: 'Live preview' }),
          focusSel,
        ]),
        scope,
      ]);

      /* ═══════════════════════ contrast checker ═════════════════════════ */
      const contrastWrap = el('div', { class: 'g-cz-contrast', 'data-cz-contrast': '' });
      const contrastPairs = [
        ['Foreground on Background', () => [getCtlHex(colorCtls, 'foreground'), getCtlHex(colorCtls, 'background')]],
        ['Primary fg on Primary', () => [getCtlHex(colorCtls, 'primary-foreground'), getCtlHex(colorCtls, 'primary')]],
        ['Muted fg on Background', () => [getCtlHex(colorCtls, 'muted-foreground'), getCtlHex(colorCtls, 'background')]],
      ];
      function getCtlHex(list, token) { const c = list.find((x) => x.token === token); return c ? c.getHex() : null; }
      updateContrast = () => {
        contrastWrap.textContent = '';
        contrastPairs.forEach(([label, getter]) => {
          const [a, b] = getter();
          const ratio = (a && b) ? czContrastRatio(a, b) : null;
          const passAA = ratio != null && ratio >= 4.5;
          const passAAA = ratio != null && ratio >= 7;
          const row = el('div', { class: 'g-cz-contrast-row' }, [
            el('span', { class: 'g-cz-contrast-lbl', text: label }),
            el('span', { class: 'g-cz-contrast-ratio', text: ratio != null ? ratio.toFixed(2) + ':1' : '—' }),
            el('span', { class: 'g-cz-badge ' + (passAA ? 'is-pass' : 'is-fail'), text: passAA ? 'AA' : 'AA✗' }),
            el('span', { class: 'g-cz-badge ' + (passAAA ? 'is-pass' : 'is-fail'), text: passAAA ? 'AAA' : 'AAA✗' }),
          ]);
          contrastWrap.appendChild(row);
        });
      };

      /* ═══════════════════════════ export panel ═════════════════════════ */
      const exportBar = el('div', { class: 'g-cz-cluster' });
      const downloadBtn = el('button', { type: 'button', class: 'g-cz-btn g-cz-btn--primary', text: 'Download theme.css', 'data-cz-download': '' });
      const copyBtn = el('button', { type: 'button', class: 'g-cz-btn', text: 'Copy CSS', 'data-cz-copy': '' });
      const shareBtn = el('button', { type: 'button', class: 'g-cz-btn', text: 'Copy share link', 'data-cz-share': '' });
      const copyNote = el('span', { class: 'g-cz-note' });
      downloadBtn.addEventListener('click', () => {
        const css = exportThemeCss(scope, CZ_EXPORT_TOKENS, ':root');
        const blob = new Blob([css], { type: 'text/css' });
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: 'theme.css' });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      copyBtn.addEventListener('click', async () => {
        const css = exportThemeCss(scope, CZ_EXPORT_TOKENS, ':root');
        try { await navigator.clipboard.writeText(css); copyNote.textContent = 'Copied!'; }
        catch (_) { code.select(); copyNote.textContent = 'Selected — press Ctrl/Cmd+C'; }
        setTimeout(() => { copyNote.textContent = ''; }, 2000);
      });
      shareBtn.addEventListener('click', async () => {
        const link = location.origin + location.pathname + buildShareHash();
        try { await navigator.clipboard.writeText(link); copyNote.textContent = 'Link copied!'; }
        catch (_) { copyNote.textContent = 'Link in URL bar'; }
        setTimeout(() => { copyNote.textContent = ''; }, 2000);
      });
      exportBar.appendChild(downloadBtn);
      exportBar.appendChild(copyBtn);
      exportBar.appendChild(shareBtn);
      exportBar.appendChild(copyNote);

      const exportPanel = el('div', { class: 'g-cz-panel g-cz-exportpanel' }, [
        el('div', { class: 'g-cz-panel-hd', text: 'Accessibility' }),
        contrastWrap,
        el('div', { class: 'g-cz-panel-hd', style: 'margin-top:1rem', text: 'Export' }),
        exportBar,
        code,
      ]);

      /* ═══════════════════════ share via URL hash ═══════════════════════ */
      function buildShareHash() {
        const payload = { base: currentBase, o: overrides };
        let enc = '';
        try { enc = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))); } catch (_) { enc = ''; }
        return '#customizer?cz=' + enc;
      }
      updateShareUrl = () => {
        // Only rewrite the hash while the customizer route is active.
        if ((location.hash || '').indexOf('customizer') === -1) return;
        try { history.replaceState(null, '', buildShareHash()); } catch (_) { /* ignore */ }
      };
      function restoreFromHash() {
        const h = location.hash || '';
        const m = h.match(/cz=([^&]+)/);
        if (!m) return false;
        let payload;
        try { payload = JSON.parse(decodeURIComponent(escape(atob(m[1])))); } catch (_) { return false; }
        if (!payload) return false;
        suspendShare = true;
        if (payload.base) { currentBase = payload.base; setTheme(payload.base, scope); baseSeg.setActive(payload.base); }
        if (payload.o && typeof payload.o === 'object') {
          applyTheme(scope, payload.o);
          for (const k in payload.o) setOverride(k, payload.o[k]);
        }
        suspendShare = false;
        refreshExport();
        return true;
      }

      wrap.appendChild(controlsCard);
      wrap.appendChild(previewCard);
      wrap.appendChild(exportPanel);
      grid.appendChild(wrap);

      // Mount Grid + Chart now that hosts are attached.
      try {
        new Grid(gridHost, {
          data: genGridRows(8),
          columns: [
            { field: 'id', header: 'ID', type: 'number', width: 56 },
            { field: 'name', header: 'Name', flex: 1, minWidth: 120 },
            { field: 'dept', header: 'Department', flex: 1, minWidth: 110 },
            { field: 'salary', header: 'Salary', type: 'number', width: 100, align: 'end', meta: { format: { grouping: true } } },
          ],
        });
      } catch (e) { console.warn('CUSTOMIZER grid failed:', e && e.message); }
      try {
        new Chart(chartHost, {
          height: 220, type: 'bar', categories: months.slice(),
          series: [
            { name: 'West', data: [12, 18, 9, 14, 20, 16] },
            { name: 'East', data: [8, 11, 15, 10, 13, 19] },
          ],
        });
      } catch (e) { console.warn('CUSTOMIZER chart failed:', e && e.message); }

      // Restore shared state from the hash (if any), then seed export/contrast.
      const restored = restoreFromHash();
      if (!restored) refreshExport();
      else refreshExport();
    },
    { wide: true },
  );
}
