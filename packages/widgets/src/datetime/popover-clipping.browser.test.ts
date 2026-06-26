/**
 * Browser (real Chromium) regression test for Gallery feedback #3 / #5:
 * picker dropdowns must NOT be clipped by an ancestor's `overflow:hidden`.
 *
 * Root cause was that each picker rendered its dropdown INSIDE the field
 * container, so an `overflow:hidden`/`clip` ancestor clipped it. The fix portals
 * each dropdown to the document/body layer and positions it `fixed` against the
 * anchor. This test mounts a representative picker (DatePicker) inside a small,
 * clipping ancestor and asserts that, when open, the calendar:
 *   1. is attached at the document/body level (NOT inside the clipping ancestor),
 *   2. is fully visible (its rect is not collapsed by the clip), and
 *   3. is positioned at the anchor (left-aligned, just below it).
 *
 * Also verifies the same portal behavior for ColorPicker.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatePicker } from './date-picker.js';
import { ColorPicker } from '../pickers/color-picker.js';

let clip: HTMLElement;

beforeEach(() => {
  // A deliberately tiny, overflow-clipping ancestor: anything rendered INSIDE it
  // and overflowing would be clipped away (zero-area / off-screen).
  clip = document.createElement('div');
  clip.style.position = 'fixed';
  clip.style.top = '40px';
  clip.style.left = '40px';
  clip.style.width = '180px';
  clip.style.height = '44px';
  clip.style.overflow = 'hidden';
  document.body.appendChild(clip);
});

afterEach(() => {
  clip.remove();
});

describe('picker dropdown clipping (real Chromium)', () => {
  it('DatePicker calendar escapes an overflow:hidden ancestor and anchors to the field', () => {
    const p = new DatePicker(clip, { value: new Date(2026, 5, 10) });
    const field = clip.querySelector('.jects-datepicker') as HTMLElement;

    p.open();

    const calendar = document.querySelector('.jects-minical') as HTMLElement;
    expect(calendar).toBeTruthy();

    // 1. The calendar must NOT live inside the clipping ancestor — it is portaled
    //    to the body layer so overflow:hidden cannot clip it.
    expect(clip.contains(calendar)).toBe(false);
    const panel = calendar.closest('.jects-dt-popover') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.parentElement).toBe(document.body);

    // 2. It must be laid out with real, non-collapsed dimensions (a clipped panel
    //    would have ~zero visible area).
    const rect = calendar.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(40);
    expect(rect.height).toBeGreaterThan(40);

    // 3. It must be positioned `fixed`, fully within the viewport (a clipped or
    //    off-screen panel would breach these), and anchored to the field:
    //    horizontally aligned/overlapping with it.
    expect(getComputedStyle(panel).position).toBe('fixed');
    const fieldRect = field.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    // Clamped into the viewport origin (a panel clipped away or pushed off-screen
    // would have a negative left/top); not stuck inside the 44px clip box.
    expect(panelRect.left).toBeGreaterThanOrEqual(0);
    expect(panelRect.top).toBeGreaterThanOrEqual(0);
    // Anchored: the panel overlaps the field's horizontal extent.
    expect(panelRect.right).toBeGreaterThan(fieldRect.left);
    expect(panelRect.left).toBeLessThan(fieldRect.right);
    // The panel is visibly larger than the 44px-tall clip box (i.e. it is NOT
    // being constrained/clipped by that overflow:hidden ancestor).
    expect(panelRect.height).toBeGreaterThan(clip.getBoundingClientRect().height);

    p.close();
    // On close the panel returns to its home inside the field.
    expect(clip.contains(p.el.querySelector('.jects-dt-popover'))).toBe(true);
    p.destroy();
  });

  it('ColorPicker popover escapes an overflow:hidden ancestor and anchors to the trigger', () => {
    const p = new ColorPicker(clip, { value: '#3366cc' });
    const trigger = clip.querySelector('.jects-colorpicker__trigger') as HTMLButtonElement;

    p.openPopover();

    const popover = document.querySelector('.jects-colorpicker__popover') as HTMLElement;
    expect(popover).toBeTruthy();
    // Portaled to the body layer, NOT inside the clipping ancestor.
    expect(clip.contains(popover)).toBe(false);
    expect(popover.parentElement).toBe(document.body);
    expect(getComputedStyle(popover).position).toBe('fixed');

    const rect = popover.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(40);
    expect(rect.height).toBeGreaterThan(40);

    // Clamped into the viewport and anchored to the trigger (horizontal overlap).
    const triggerRect = trigger.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeGreaterThan(triggerRect.left);
    expect(rect.left).toBeLessThan(triggerRect.right);
    // Larger than the 44px-tall clip box → not constrained by overflow:hidden.
    expect(rect.height).toBeGreaterThan(clip.getBoundingClientRect().height);

    p.close();
    // Restored inside the field on close.
    expect(clip.contains(clip.querySelector('.jects-colorpicker__popover'))).toBe(true);
    p.destroy();
  });
});
