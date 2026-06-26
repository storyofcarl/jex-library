/**
 * Visual / interaction SMOKE test (real Chromium).
 *
 * Exercises the booking widget's happy path end-to-end in a real browser:
 *   1. the calendar + slot grid render with correct token-driven layout,
 *   2. picking a slot reveals the reservation form (the core booking gesture),
 *   3. a body-level popup (a `select` extra-field) opens at `document.body` and
 *      is NOT clipped by any `overflow:hidden`/`clip` ancestor of the widget.
 *
 * The third assertion guards the gallery-feedback class of bug where editors /
 * dropdowns get clipped because they were mounted inside the component's
 * overflow box instead of escaping to the body.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '@jects/widgets/style.css';
import '../styles.css';
import '../index.js';
import { Booking } from './booking.js';

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  // A deliberately clipped, fixed-size host: if a popup mounted *inside* the
  // booking root it would be clipped by this overflow box. Mounting at body
  // level escapes it.
  host.style.width = '760px';
  host.style.height = '560px';
  host.style.overflow = 'hidden';
  host.style.position = 'absolute';
  host.style.top = '0';
  host.style.left = '0';
  document.body.appendChild(host);
});
afterEach(() => host.remove());

const DAY = new Date(2030, 5, 24); // future day → no past slots

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe('Booking — visual/interaction smoke', () => {
  it('renders the calendar + a non-empty, non-overlapping slot grid', async () => {
    const b = new Booking(host, {
      date: DAY,
      workingHours: { start: '09:00', end: '12:00' },
      slotDuration: 30,
    });
    await nextFrame();

    const root = host.querySelector('.jects-booking') as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.querySelector('.jects-minical')).toBeTruthy();

    const slots = [...root.querySelectorAll<HTMLElement>('.jects-booking__slot')];
    expect(slots.length).toBe(6); // 09:00..11:30

    // Every slot has real layout box (rendered, not display:none) and no two
    // slots overlap (the CSS grid lays them out cleanly).
    const rects = slots.map((s) => s.getBoundingClientRect());
    rects.forEach((r) => {
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
    });
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const c = rects[j];
        const overlap =
          a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
        expect(overlap, `slots ${i} and ${j} must not overlap`).toBe(false);
      }
    }
    b.destroy();
  });

  it('picking a slot opens the reservation form', async () => {
    const b = new Booking(host, {
      date: DAY,
      workingHours: { start: '09:00', end: '11:00' },
      slotDuration: 30,
    });
    await nextFrame();

    expect(host.querySelector<HTMLElement>('.jects-booking__form-section')!.hidden).toBe(true);

    // Click the 09:30 slot button (real DOM click).
    const slotBtn = host.querySelector<HTMLButtonElement>(
      '.jects-booking__slot[data-time="09:30"]',
    )!;
    slotBtn.click();
    await nextFrame();

    expect(b.getSelectedTime()).toBe('09:30');
    // render() rebuilt the subtree — re-query the (new) form section.
    const section = host.querySelector<HTMLElement>('.jects-booking__form-section')!;
    expect(section.hidden).toBe(false);
    const form = host.querySelector<HTMLElement>('.jects-form')!;
    expect(form).toBeTruthy();
    // The form is visible with a real layout box.
    expect(form.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(host.querySelector('[data-field="name"]')).toBeTruthy();
    expect(host.querySelector('[data-field="email"]')).toBeTruthy();
    b.destroy();
  });

  it('a select extra-field popup mounts at body level and is not clipped', async () => {
    const b = new Booking(host, {
      date: DAY,
      workingHours: { start: '09:00', end: '11:00' },
      slotDuration: 30,
      extraFields: [
        {
          name: 'service',
          control: 'select',
          label: 'Service',
          props: {
            options: [
              { value: 'a', label: 'Service A' },
              { value: 'b', label: 'Service B' },
              { value: 'c', label: 'Service C' },
            ],
          },
        },
      ],
    });
    await nextFrame();

    // Reveal the form (which contains the select).
    host.querySelector<HTMLButtonElement>('.jects-booking__slot[data-time="09:30"]')!.click();
    await nextFrame();

    const trigger = host.querySelector<HTMLButtonElement>('.jects-select__trigger')!;
    expect(trigger).toBeTruthy();
    trigger.click(); // open the dropdown
    await nextFrame();
    await tick();

    const listbox = document.querySelector<HTMLElement>('.jects-select__listbox')!;
    expect(listbox, 'select listbox should be rendered').toBeTruthy();

    // It must mount at BODY level — escaping the clipped booking host — not
    // inside the booking root (which has overflow:hidden). This is the crux: a
    // panel mounted inside the host would be visually clipped.
    expect(host.contains(listbox)).toBe(false);
    expect(document.body.contains(listbox)).toBe(true);

    // It has a real, un-collapsed layout box (it is actually visible, not
    // clipped to zero by an overflow ancestor).
    const r = listbox.getBoundingClientRect();
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);

    // Its top-left is on-screen (it is not pushed entirely outside the viewport).
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.top).toBeLessThan(window.innerHeight);

    // The options rendered.
    expect(listbox.querySelectorAll('[role="option"]').length).toBe(3);

    b.destroy();
  });
});
