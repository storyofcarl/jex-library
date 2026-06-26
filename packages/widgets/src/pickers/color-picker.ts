/**
 * ColorPicker — an HSV color picker with its own popover trigger.
 *
 * Anatomy:
 *  - a trigger button showing the current swatch + hex value
 *  - a popover containing:
 *      - a saturation/value area (2D drag)
 *      - a hue slider
 *      - an alpha slider
 *      - hex + RGB numeric inputs
 *      - swatches, including a Calm CMYK palette
 *
 * Value is exposed as a hex string (`#rrggbb` or `#rrggbbaa` when alpha < 1).
 * Emits `beforeChange` (vetoable) then `change`.
 *
 * NOTE: the picker renders dynamic, USER-chosen colors via inline styles / JS-set
 * CSS custom properties (the SV area background, the swatch fills, the preview).
 * That is allowed. The component's own CHROME lives in color-picker.css and is
 * token-pure.
 *
 * IMPORTANT (matches the Button reference): with `useDefineForClassFields`, subclass
 * instance fields are (re)initialised AFTER `super()` runs `buildEl()` + `render()`,
 * which would wipe any DOM refs / state stored on fields. So this class keeps NO
 * surviving instance fields: DOM nodes are queried from `this.el`, and mutable
 * picker state lives in a small state object stashed on the root element.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';
import { positionAnchoredPanel } from '../overlays/anchored-panel.js';

export interface ColorPickerConfig extends WidgetConfig {
  /** Current value as a hex string (`#rgb`, `#rrggbb`, or `#rrggbbaa`). Default `#000000`. */
  value?: string;
  /** Whether to show the alpha slider + alpha-aware hex. Default `true`. */
  alpha?: boolean;
  /** Swatch hex values shown under the controls. Defaults to the Calm CMYK palette. */
  swatches?: string[];
  /** Disable interaction. */
  disabled?: boolean;
  /** Accessible label for the trigger. Default `Choose color`. */
  label?: string;
  /** Convenience change handler (also available via `.on('change', ...)`). */
  onChange?: (value: string) => void;
}

export interface ColorPickerEvents extends WidgetEvents {
  /** Vetoable: return `false` from a handler to reject the new value. */
  beforeChange: { value: string; previous: string; picker: ColorPicker };
  change: { value: string; previous: string; picker: ColorPicker };
  /** Popover opened. */
  open: { picker: ColorPicker };
  /** Popover closed. */
  close: { picker: ColorPicker };
}

interface RGB {
  r: number;
  g: number;
  b: number;
}
interface HSV {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
}

interface PickerState {
  hsv: HSV;
  a: number;
  open: boolean;
  svDragging: boolean;
  docCleanup: (() => void) | null;
  /** The popover panel element (stashed so getters resolve it once portaled). */
  popoverEl: HTMLElement | null;
  /** Original parent + next sibling of the popover, restored on close. */
  popoverHomeParent: Node | null;
  popoverHomeNext: Node | null;
  /** Reposition handler bound while open (for scroll/resize). */
  reposition: (() => void) | null;
}

/** The Calm CMYK palette + neutral anchors used as the default swatch set. */
const CMYK_SWATCHES = [
  '#000000',
  '#3f3f46',
  '#71717a',
  '#a1a1aa',
  '#d4d4d8',
  '#ffffff',
  '#00aeef', // cyan
  '#ec008c', // magenta
  '#fff200', // yellow
  '#231f20', // key
];

type StatefulEl = HTMLElement & { _jectsCp?: PickerState };

export class ColorPicker extends Widget<ColorPickerConfig, ColorPickerEvents> {
  protected override defaults(): Partial<ColorPickerConfig> {
    return { value: '#000000', alpha: true, label: 'Choose color', swatches: CMYK_SWATCHES };
  }

  /** Per-instance state, stashed on the root element so it survives field init. */
  private get state(): PickerState {
    const el = this.el as StatefulEl;
    if (!el._jectsCp) {
      el._jectsCp = {
        hsv: { h: 0, s: 0, v: 0 },
        a: 1,
        open: false,
        svDragging: false,
        docCleanup: null,
        popoverEl: null,
        popoverHomeParent: null,
        popoverHomeNext: null,
        reposition: null,
      };
    }
    return el._jectsCp;
  }

  // ---- DOM ref accessors (queried, never stored on fields) -----------------
  private get trigger(): HTMLButtonElement {
    return this.el.querySelector('.jects-colorpicker__trigger') as HTMLButtonElement;
  }
  /**
   * The popover panel. Resolved from the stashed reference so callers find it
   * whether it currently lives inside the root (closed) or portaled to the body
   * layer (open). Falls back to a query for the initial render.
   */
  private get popover(): HTMLElement {
    const st = this.state;
    if (!st.popoverEl) {
      st.popoverEl = this.el.querySelector('.jects-colorpicker__popover') as HTMLElement;
    }
    return st.popoverEl;
  }
  private get svArea(): HTMLElement {
    return this.popover.querySelector('.jects-colorpicker__sv') as HTMLElement;
  }
  private get svThumb(): HTMLElement {
    return this.popover.querySelector('.jects-colorpicker__sv-thumb') as HTMLElement;
  }
  private get hueInput(): HTMLInputElement {
    return this.popover.querySelector('.jects-colorpicker__hue') as HTMLInputElement;
  }
  private get alphaInput(): HTMLInputElement {
    return this.popover.querySelector('.jects-colorpicker__alpha') as HTMLInputElement;
  }
  private get hexInput(): HTMLInputElement {
    return this.popover.querySelector('.jects-colorpicker__hex') as HTMLInputElement;
  }
  private get rgbInputs(): HTMLInputElement[] {
    return Array.from(this.popover.querySelectorAll<HTMLInputElement>('.jects-colorpicker__num'));
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-colorpicker' });

    // ----- trigger -----
    const trigger = createEl('button', {
      className: 'jects-colorpicker__trigger',
      attrs: { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
    });
    const triggerSwatch = createEl('span', {
      className: 'jects-colorpicker__trigger-swatch',
      attrs: { 'aria-hidden': 'true' },
    });
    const triggerText = createEl('span', { className: 'jects-colorpicker__trigger-text' });
    trigger.append(triggerSwatch, triggerText);
    trigger.addEventListener('click', () => this.toggle());

    // ----- popover -----
    const popover = createEl('div', {
      className: 'jects-colorpicker__popover',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Color picker',
        tabindex: '-1',
        hidden: '',
      },
    });

    // saturation / value area
    // A 2D control can't be fully expressed by a single slider role, so we keep
    // role="slider" but also publish a concrete numeric value (aria-valuenow =
    // saturation %) alongside aria-valuetext so assistive tech announces a
    // determinate value rather than an indeterminate slider.
    const svArea = createEl('div', {
      className: 'jects-colorpicker__sv',
      attrs: {
        role: 'slider',
        tabindex: '0',
        'aria-label': 'Saturation and brightness',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': '0',
        'aria-orientation': 'horizontal',
      },
    });
    const svThumb = createEl('div', { className: 'jects-colorpicker__sv-thumb' });
    svArea.append(svThumb);
    svArea.addEventListener('pointerdown', (e) => this.onSvPointerDown(e as PointerEvent));
    svArea.addEventListener('keydown', (e) => this.onSvKeyDown(e as KeyboardEvent));

    // hue slider
    const hueInput = createEl('input', {
      className: 'jects-colorpicker__hue',
      attrs: { type: 'range', min: '0', max: '360', step: '1', 'aria-label': 'Hue' },
    });
    hueInput.addEventListener('input', () => this.onHueInput());

    // alpha slider
    const alphaInput = createEl('input', {
      className: 'jects-colorpicker__alpha',
      attrs: { type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Alpha' },
    });
    alphaInput.addEventListener('input', () => this.onAlphaInput());

    // hex + RGB inputs
    const hexInput = createEl('input', {
      className: 'jects-colorpicker__hex',
      attrs: { type: 'text', spellcheck: 'false', 'aria-label': 'Hex value' },
    });
    hexInput.addEventListener('change', () => this.onHexInput());

    const rInput = this.numInput('Red');
    const gInput = this.numInput('Green');
    const bInput = this.numInput('Blue');
    for (const inp of [rInput, gInput, bInput]) {
      inp.addEventListener('change', () => this.onRgbInput());
    }

    const previewEl = createEl('span', {
      className: 'jects-colorpicker__preview',
      attrs: { 'aria-hidden': 'true' },
    });

    const sliderCol = createEl('div', { className: 'jects-colorpicker__slider-col' });
    sliderCol.append(hueInput, alphaInput);
    const sliders = createEl('div', { className: 'jects-colorpicker__sliders' });
    sliders.append(previewEl, sliderCol);

    const hexRow = createEl('div', { className: 'jects-colorpicker__inputs' });
    hexRow.append(
      this.field('HEX', hexInput),
      this.field('R', rInput),
      this.field('G', gInput),
      this.field('B', bInput),
    );

    const swatches = createEl('div', {
      className: 'jects-colorpicker__swatches',
      attrs: { role: 'group', 'aria-label': 'Swatches' },
    });

    popover.append(svArea, sliders, hexRow, swatches);
    root.append(trigger, popover);
    return root;
  }

  private numInput(label: string): HTMLInputElement {
    return createEl('input', {
      className: 'jects-colorpicker__num',
      attrs: { type: 'number', min: '0', max: '255', step: '1', 'aria-label': label },
    });
  }

  private field(label: string, control: HTMLElement): HTMLElement {
    const f = createEl('label', { className: 'jects-colorpicker__field' });
    f.append(createEl('span', { className: 'jects-colorpicker__field-label', text: label }), control);
    return f;
  }

  // ---- popover open/close -------------------------------------------------

  toggle(): this {
    return this.state.open ? this.close() : this.openPopover();
  }

  openPopover(): this {
    const st = this.state;
    if (st.open || this.config.disabled) return this;
    st.open = true;
    const popover = this.popover;
    popover.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.el.classList.add('jects-colorpicker--open');

    // Portal the popover to the body layer so it escapes any clipping/overflow
    // ancestor of the field, then position it `fixed` against the trigger.
    st.popoverHomeParent = popover.parentNode;
    st.popoverHomeNext = popover.nextSibling;
    document.body.appendChild(popover);
    this.positionPopover();

    const onDocPointer = (e: PointerEvent): void => {
      const t = e.target as Node;
      // Keep open for clicks inside the field OR inside the portaled popover.
      if (this.el.contains(t) || popover.contains(t)) return;
      this.close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
        return;
      }
      // Focus trap: keep Tab / Shift+Tab within the popover while it is modal.
      if (e.key === 'Tab') this.handleTabTrap(e);
    };
    const onReposition = (): void => this.positionPopover();
    document.addEventListener('pointerdown', onDocPointer, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    st.reposition = onReposition;
    // Store the removers in state and call them in close(). We do NOT track()
    // these per-open closures on the base disposers array (that would grow
    // unbounded across open/close cycles); the destroy() override below routes
    // the destroy-while-open case through close().
    st.docCleanup = () => {
      document.removeEventListener('pointerdown', onDocPointer, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };

    // Move focus into the dialog so keyboard / screen-reader users land on the
    // controls instead of being stranded on the trigger.
    const first = this.firstFocusable();
    (first ?? this.popover).focus();

    this.emit('open', { picker: this });
    return this;
  }

  close(): this {
    const st = this.state;
    if (!st.open) return this;
    st.open = false;
    const popover = this.popover;
    popover.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.el.classList.remove('jects-colorpicker--open');
    st.docCleanup?.();
    st.docCleanup = null;
    st.reposition = null;
    // Restore focus to the trigger for every close path (Escape, outside click,
    // programmatic close), not just Escape — as long as focus is still inside
    // the popover (don't steal focus if the user already clicked elsewhere).
    const focusWasInside = popover.contains(document.activeElement);
    // Return the popover from the body layer to its home inside the field, and
    // clear the JS-applied fixed position so it lays out under the trigger again.
    popover.style.position = '';
    popover.style.left = '';
    popover.style.top = '';
    if (st.popoverHomeParent) {
      st.popoverHomeParent.insertBefore(popover, st.popoverHomeNext);
    }
    st.popoverHomeParent = null;
    st.popoverHomeNext = null;
    if (focusWasInside) this.trigger.focus();
    this.emit('close', { picker: this });
    return this;
  }

  /** Position the portaled popover against the trigger (fixed, with flip). */
  private positionPopover(): void {
    if (!this.state.open) return;
    positionAnchoredPanel(this.popover, this.trigger, {
      placement: 'bottom',
      align: 'start',
      offset: 8,
    });
  }

  /** All focusable controls inside the popover, in DOM order. */
  private focusableEls(): HTMLElement[] {
    const sel =
      'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';
    return Array.from(this.popover.querySelectorAll<HTMLElement>(sel)).filter(
      (el) => !el.hasAttribute('disabled') && !el.hidden && el.getAttribute('aria-hidden') !== 'true',
    );
  }

  private firstFocusable(): HTMLElement | null {
    return this.focusableEls()[0] ?? null;
  }

  /** Wrap Tab / Shift+Tab focus within the open popover. */
  private handleTabTrap(e: KeyboardEvent): void {
    const focusable = this.focusableEls();
    if (focusable.length === 0) {
      e.preventDefault();
      this.popover.focus();
      return;
    }
    const firstEl = focusable[0]!;
    const lastEl = focusable[focusable.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === firstEl || !this.popover.contains(active)) {
        e.preventDefault();
        lastEl.focus();
      }
    } else if (active === lastEl || !this.popover.contains(active)) {
      e.preventDefault();
      firstEl.focus();
    }
  }

  /** Ensure document listeners are torn down even if destroyed while open. */
  override destroy(): void {
    const el = this.el as StatefulEl;
    // Use the stashed state directly (not the `state` getter) to avoid
    // re-creating state on an element that may already be torn down.
    const st = el._jectsCp;
    st?.docCleanup?.();
    if (st) {
      st.docCleanup = null;
      st.reposition = null;
      // If destroyed while open the popover is portaled to the body; the base
      // destroy() only removes the root, so remove the orphaned panel here.
      st.popoverEl?.remove();
      st.popoverHomeParent = null;
      st.popoverHomeNext = null;
    }
    super.destroy();
  }

  // ---- SV area interaction ------------------------------------------------

  private onSvPointerDown(e: PointerEvent): void {
    if (this.config.disabled) return;
    const st = this.state;
    st.svDragging = true;
    const sv = this.svArea;
    sv.setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent): void => {
      if (st.svDragging) this.applySvFromPointer(ev);
    };
    const up = (ev: PointerEvent): void => {
      st.svDragging = false;
      sv.releasePointerCapture?.(ev.pointerId);
      sv.removeEventListener('pointermove', move);
      sv.removeEventListener('pointerup', up);
    };
    sv.addEventListener('pointermove', move);
    sv.addEventListener('pointerup', up);
    this.applySvFromPointer(e);
  }

  private applySvFromPointer(e: PointerEvent): void {
    const rect = this.svArea.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    const x = clamp((e.clientX - rect.left) / w, 0, 1);
    const y = clamp((e.clientY - rect.top) / h, 0, 1);
    const st = this.state;
    st.hsv = { ...st.hsv, s: x, v: 1 - y };
    this.commitFromHsv();
  }

  private onSvKeyDown(e: KeyboardEvent): void {
    if (this.config.disabled) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    const st = this.state;
    let { s, v } = st.hsv;
    switch (e.key) {
      case 'ArrowLeft':
        s -= step;
        break;
      case 'ArrowRight':
        s += step;
        break;
      case 'ArrowUp':
        v += step;
        break;
      case 'ArrowDown':
        v -= step;
        break;
      default:
        return;
    }
    e.preventDefault();
    st.hsv = { ...st.hsv, s: clamp(s, 0, 1), v: clamp(v, 0, 1) };
    this.commitFromHsv();
  }

  private onHueInput(): void {
    const st = this.state;
    st.hsv = { ...st.hsv, h: Number(this.hueInput.value) };
    this.commitFromHsv();
  }

  private onAlphaInput(): void {
    this.state.a = Number(this.alphaInput.value) / 100;
    this.commitFromHsv();
  }

  private onHexInput(): void {
    const parsed = parseHex(this.hexInput.value);
    if (!parsed) {
      this.syncControls(); // revert invalid input
      return;
    }
    const st = this.state;
    st.hsv = rgbToHsv(parsed);
    st.a = parsed.a;
    this.commitFromHsv();
  }

  private onRgbInput(): void {
    const [rIn, gIn, bIn] = this.rgbInputs;
    const r = clamp(Math.round(Number(rIn?.value) || 0), 0, 255);
    const g = clamp(Math.round(Number(gIn?.value) || 0), 0, 255);
    const b = clamp(Math.round(Number(bIn?.value) || 0), 0, 255);
    this.state.hsv = rgbToHsv({ r, g, b });
    this.commitFromHsv();
  }

  private onSwatchClick(hex: string): void {
    const parsed = parseHex(hex);
    if (!parsed) return;
    const st = this.state;
    st.hsv = rgbToHsv(parsed);
    st.a = parsed.a;
    this.commitFromHsv();
  }

  // ---- value plumbing -----------------------------------------------------

  /** Current value as hex (alpha-aware when alpha enabled and < 1). */
  getValue(): string {
    const st = this.state;
    const rgb = hsvToRgb(st.hsv);
    const useAlpha = this.config.alpha !== false && st.a < 1;
    return rgbToHex(rgb, useAlpha ? st.a : 1);
  }

  /** Programmatically set the value (hex string). Emits change like user input. */
  setValue(hex: string): this {
    const parsed = parseHex(hex);
    if (!parsed) return this;
    const st = this.state;
    st.hsv = rgbToHsv(parsed);
    st.a = parsed.a;
    this.commitFromHsv();
    return this;
  }

  private commitFromHsv(): void {
    const previous = this.config.value ?? '#000000';
    const value = this.getValue();
    if (value === previous) {
      this.syncControls();
      return;
    }
    if (this.emit('beforeChange', { value, previous, picker: this }) === false) {
      this.restoreFromConfig(); // revert internal state to the (unchanged) value
      this.syncControls();
      return;
    }
    this.config.value = value;
    this.syncControls();
    this.config.onChange?.(value);
    this.emit('change', { value, previous, picker: this });
  }

  /** Reset internal hsv/alpha from the current config value (used to revert vetoes). */
  private restoreFromConfig(): void {
    const parsed = parseHex(this.config.value ?? '#000000');
    if (!parsed) return;
    const st = this.state;
    st.hsv = rgbToHsv(parsed);
    st.a = this.config.alpha === false ? 1 : parsed.a;
  }

  protected override render(): void {
    const { disabled = false, label = 'Choose color' } = this.config;
    this.el.classList.toggle('jects-colorpicker--disabled', disabled);
    this.trigger.disabled = disabled;
    this.trigger.setAttribute('aria-label', label);
    this.alphaInput.hidden = this.config.alpha === false;

    // initialize hsv/alpha from config value (first render or external update)
    const parsed = parseHex(this.config.value ?? '#000000');
    if (parsed) {
      const st = this.state;
      st.hsv = rgbToHsv(parsed);
      st.a = this.config.alpha === false ? 1 : parsed.a;
    }

    // Full-spectrum hue rail as an inline gradient (algorithmic colors → inline,
    // keeps the stylesheet literal-free; CSS provides a token fallback).
    const stops: string[] = [];
    for (let h = 0; h <= 360; h += 30) {
      stops.push(rgbToHex(hsvToRgb({ h, s: 1, v: 1 }), 1));
    }
    this.hueInput.style.setProperty('--_hue-rail', `linear-gradient(to right, ${stops.join(', ')})`);

    this.renderSwatches();
    this.syncControls();
  }

  private renderSwatches(): void {
    const wrap = this.popover.querySelector('.jects-colorpicker__swatches')!;
    // jects-safe-html: empty clear; swatches built below as DOM nodes
    wrap.innerHTML = '';
    const swatches = this.config.swatches ?? CMYK_SWATCHES;
    for (const hex of swatches) {
      const btn = createEl('button', {
        className: 'jects-colorpicker__swatch',
        attrs: { type: 'button', 'aria-label': hex, title: hex },
      });
      // dynamic, user-data color → inline custom property (allowed; not chrome).
      btn.style.setProperty('--_swatch', hex);
      btn.addEventListener('click', () => this.onSwatchClick(hex));
      wrap.append(btn);
    }
  }

  /** Push the current hsv/alpha into every control + preview (no events). */
  private syncControls(): void {
    const st = this.state;
    const rgb = hsvToRgb(st.hsv);
    const hex = rgbToHex(rgb, 1);
    const display = this.getValue();

    // trigger
    const triggerSwatch = this.el.querySelector('.jects-colorpicker__trigger-swatch') as HTMLElement;
    const triggerText = this.el.querySelector('.jects-colorpicker__trigger-text') as HTMLElement;
    triggerSwatch.style.setProperty('--_swatch', display);
    triggerText.textContent = display;

    // sv area background hue + thumb position (dynamic / algorithmic colors → inline)
    const sv = this.svArea;
    const hueColor = rgbToHex(hsvToRgb({ h: st.hsv.h, s: 1, v: 1 }), 1);
    sv.style.setProperty('--_hue', hueColor);
    sv.style.setProperty('--_white', '#ffffff');
    sv.style.setProperty('--_black', '#000000');
    const thumb = this.svThumb;
    thumb.style.left = `${st.hsv.s * 100}%`;
    thumb.style.top = `${(1 - st.hsv.v) * 100}%`;
    thumb.style.setProperty('--_thumb', hex);
    sv.setAttribute('aria-valuenow', String(Math.round(st.hsv.s * 100)));
    sv.setAttribute(
      'aria-valuetext',
      `Saturation ${Math.round(st.hsv.s * 100)}%, brightness ${Math.round(st.hsv.v * 100)}%`,
    );

    // sliders
    this.hueInput.value = String(Math.round(st.hsv.h));
    const alpha = this.alphaInput;
    alpha.value = String(Math.round(st.a * 100));
    alpha.style.setProperty('--_alpha-color', hex);

    // preview
    const preview = this.popover.querySelector('.jects-colorpicker__preview') as HTMLElement;
    preview.style.setProperty('--_preview', display);

    // inputs
    const hexInput = this.hexInput;
    if (document.activeElement !== hexInput) hexInput.value = display;
    const [rIn, gIn, bIn] = this.rgbInputs;
    if (rIn && document.activeElement !== rIn) rIn.value = String(rgb.r);
    if (gIn && document.activeElement !== gIn) gIn.value = String(rgb.g);
    if (bIn && document.activeElement !== bIn) bIn.value = String(rgb.b);
  }
}

// ---- color math -----------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function hsvToRgb({ h, s, v }: HSV): RGB {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function rgbToHsv({ r, g, b }: RGB): HSV {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function toHexByte(n: number): string {
  return clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
}

function rgbToHex({ r, g, b }: RGB, a: number): string {
  let hex = `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
  if (a < 1) hex += toHexByte(a * 255);
  return hex;
}

/** Parse `#rgb` / `#rrggbb` / `#rrggbbaa` (with or without leading #). Returns rgba or null. */
export function parseHex(input: string): (RGB & { a: number }) | null {
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/^#/, '');
  if (s.length === 3 || s.length === 4) {
    s = s
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (s.length !== 6 && s.length !== 8) return null;
  if (!/^[0-9a-fA-F]+$/.test(s)) return null;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

register(
  'colorpicker',
  ColorPicker as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => ColorPicker,
);
