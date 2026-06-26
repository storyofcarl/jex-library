/**
 * XSS hardening suite for the Booking widget (docs/SECURITY.md surface #10:
 * "Booking service/reservation fields — names, notes, custom fields → escaped").
 *
 * Booking composes its DOM exclusively via `createEl({ text })` / `textContent`
 * (never `innerHTML` / `html:`), so every caller-supplied string — service and
 * resource names, per-service intake field labels, global `extraFields` labels,
 * headings, button text and i18n message overrides — is escaped by the DOM. This
 * spec proves it by injecting the standard payloads into each untrusted field and
 * asserting that (a) no injected handler/script ever executes, (b) the rendered
 * DOM contains no `<script>`, `on*` handler attribute, or `javascript:` URL, and
 * (c) legitimate text still renders verbatim.
 *
 * Runs in jsdom via the default `pnpm test`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../index.js';
import { Booking } from './booking.js';

let host: HTMLElement;

/** Global tripwire — any executed payload flips this true. */
declare global {
  // eslint-disable-next-line no-var
  var __xss: boolean;
}

beforeEach(() => {
  globalThis.__xss = false;
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
  globalThis.__xss = false;
});

/** Fixed future day so generated slots are never "past". */
const DAY = new Date(2030, 5, 24); // 2030-06-24 (Monday)

/** The standard injection corpus from docs/SECURITY.md §4. */
const PAYLOADS = [
  '<img src=x onerror="globalThis.__xss=true">',
  '<script>globalThis.__xss=true</script>',
  '<svg onload="globalThis.__xss=true"></svg>',
  '"><iframe src="javascript:globalThis.__xss=true"></iframe>',
  '<a href="javascript:globalThis.__xss=true">click</a>',
  '<div style="background:url(javascript:globalThis.__xss=true)">x</div>',
  'data:text/html,<script>globalThis.__xss=true</script>',
] as const;

const EVIL = PAYLOADS.join(' ');

/** Assert the rendered subtree carries no executable injection vector. */
function assertCleanDom(root: HTMLElement): void {
  // No script element materialized from any escaped payload.
  expect(root.querySelectorAll('script').length).toBe(0);
  // No element acquired an inline event-handler attribute.
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    for (const attr of Array.from(el.attributes)) {
      expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
      if (attr.name === 'href' || attr.name === 'src' || attr.name === 'xlink:href') {
        expect(attr.value.toLowerCase()).not.toContain('javascript:');
      }
    }
  }
  // No anchors/iframes/images smuggled in by the payloads.
  expect(root.querySelector('iframe')).toBeNull();
  expect(root.querySelector('a[href^="javascript:"]')).toBeNull();
  expect(root.querySelector('img[onerror]')).toBeNull();
}

describe('Booking — XSS hardening (service / reservation fields)', () => {
  it('escapes malicious service + resource names and renders them as inert text', () => {
    const b = new Booking(host, {
      date: DAY,
      workingHours: { start: '09:00', end: '11:00' },
      ariaLabel: EVIL,
      slotsHeading: EVIL,
      services: [
        { id: 's1', name: EVIL, duration: 30 },
        { id: 's2', name: 'Haircut', duration: 30 },
      ],
    });
    expect(globalThis.__xss).toBe(false);
    assertCleanDom(b.el);
    // The payload survives as literal text on the service button (escaped, inert).
    const nameEl = b.el.querySelector('.jects-booking__service-name');
    expect(nameEl?.textContent).toBe(EVIL);
    expect(nameEl?.querySelector('*')).toBeNull(); // pure text node, no parsed markup
    b.destroy();
  });

  it('escapes malicious resource names', () => {
    const b = new Booking(host, {
      date: DAY,
      workingHours: { start: '09:00', end: '10:00' },
      resources: [
        { id: 'r1', name: EVIL },
        { id: 'r2', name: 'Chair 2' },
      ],
    });
    expect(globalThis.__xss).toBe(false);
    assertCleanDom(b.el);
    b.destroy();
  });

  it('escapes malicious per-service intake + global extra field labels in the form', () => {
    const b = new Booking(host, {
      date: DAY,
      workingHours: { start: '09:00', end: '11:00' },
      confirmText: EVIL,
      services: [
        {
          id: 'color',
          name: 'Coloring',
          duration: 60,
          fields: [{ name: 'shade', control: 'text', label: EVIL }],
        },
      ],
      extraFields: [{ name: 'company', control: 'text', label: EVIL }],
    });
    b.selectService('color');
    b.selectSlot('09:00'); // reveals the reservation form (renders field labels)

    expect(globalThis.__xss).toBe(false);
    assertCleanDom(b.el);
    // The intake field actually mounted, proving the form rendered (and stayed clean).
    expect(b.el.querySelector('[data-field="shade"]')).not.toBeNull();
    expect(b.el.querySelector('[data-field="company"]')).not.toBeNull();
    b.destroy();
  });

  it('escapes malicious i18n message overrides (headings + buttons)', () => {
    const b = new Booking(host, {
      date: DAY,
      workingHours: { start: '09:00', end: '11:00' },
      messages: {
        manageHeading: EVIL,
        reschedule: EVIL,
        cancel: EVIL,
        confirmBooking: EVIL,
        fieldName: EVIL,
        fieldEmail: EVIL,
        fieldNotes: EVIL,
      },
    });
    b.selectSlot('09:00'); // renders the form (field labels + confirm button text)
    expect(globalThis.__xss).toBe(false);
    assertCleanDom(b.el);
    b.destroy();
  });

  it('keeps the tripwire false after a render churn cycle', () => {
    const b = new Booking(host, {
      date: DAY,
      workingHours: { start: '09:00', end: '11:00' },
      services: [
        { id: 's1', name: EVIL, duration: 30 },
        { id: 's2', name: 'Massage', duration: 30 },
      ],
    });
    b.selectService('s2');
    b.selectSlot('09:00');
    b.selectService('s1');
    // Legitimate text still renders verbatim somewhere in the tree.
    expect(b.el.textContent).toContain('Massage');
    expect(globalThis.__xss).toBe(false);
    assertCleanDom(b.el);
    b.destroy();
  });
});
