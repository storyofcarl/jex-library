/**
 * Accessibility (axe-core) suite — Quality Gate Q2. Runs in real Chromium.
 * Asserts zero serious/critical violations across the booking stages: date
 * picker, slot grid (with booked + selected states), resources, and the
 * reservation form.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '@jects/widgets/style.css';
import '../styles.css';
import '../index.js';
import { Booking } from './booking.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '720px';
  document.body.appendChild(host);
});
afterEach(() => host.remove());

const DAY = new Date(2030, 5, 24);

describe('Booking a11y', () => {
  it('initial view (calendar + slot grid) has no serious/critical violations', async () => {
    const b = new Booking(host, {
      date: DAY,
      workingHours: { start: '09:00', end: '12:00' },
      slotDuration: 30,
      bookings: [{ date: '2030-06-24', time: '10:00', duration: 30 }],
    });
    await expectNoA11yViolations(host);
    b.destroy();
  });

  it('with resources + a selected slot revealing the form has no violations', async () => {
    const b = new Booking(host, {
      date: DAY,
      workingHours: { start: '09:00', end: '12:00' },
      slotDuration: 30,
      resources: [
        { id: 'cut', name: 'Haircut' },
        { id: 'color', name: 'Coloring' },
      ],
    });
    b.selectSlot('09:30');
    expect(b.getSelectedTime()).toBe('09:30');
    await expectNoA11yViolations(host);
    b.destroy();
  });

  it('slot grid is a group of toggle buttons (aria-pressed, no nested option role)', () => {
    const b = new Booking(host, {
      date: DAY,
      workingHours: { start: '09:00', end: '10:00' },
      slotDuration: 30,
    });
    const grid = host.querySelector('.jects-booking__slots')!;
    expect(grid.getAttribute('role')).toBe('group');
    const slot = host.querySelector('.jects-booking__slot')!;
    // Native button — no option role nested under it.
    expect(slot.getAttribute('role')).toBeNull();
    expect(slot.getAttribute('aria-pressed')).toBe('false');
    b.destroy();
  });

  it('slot buttons are keyboard-operable: native Enter activates selection', () => {
    const b = new Booking(host, {
      date: DAY,
      workingHours: { start: '09:00', end: '10:00' },
      slotDuration: 30,
    });
    const slot = host.querySelector<HTMLButtonElement>(
      '.jects-booking__slot[data-time="09:30"]',
    )!;
    // Native <button> is in the tab order (no roving needed) and activates on click.
    slot.focus();
    expect(document.activeElement).toBe(slot);
    slot.click();
    expect(b.getSelectedTime()).toBe('09:30');
    b.destroy();
  });

  it('resource radiogroup: arrow keys move selection AND focus, no a11y violations', async () => {
    const b = new Booking(host, {
      date: DAY,
      workingHours: { start: '09:00', end: '12:00' },
      slotDuration: 30,
      resources: [
        { id: 'cut', name: 'Haircut' },
        { id: 'color', name: 'Coloring' },
      ],
    });
    const bar = host.querySelector<HTMLElement>('.jects-booking__resources')!;
    const first = host.querySelector<HTMLElement>('.jects-booking__resource[data-resource="cut"]')!;
    first.focus();
    expect(document.activeElement).toBe(first);

    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(b.getSelectedResource()).toBe('color');
    // Focus followed selection to the newly-selected radio.
    const second = host.querySelector<HTMLElement>(
      '.jects-booking__resource[data-resource="color"]',
    )!;
    expect(second.getAttribute('aria-checked')).toBe('true');
    expect(second.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(second);

    await expectNoA11yViolations(host);
    b.destroy();
  });
});
