/**
 * XSS hardening suite for @jects/calendar (docs/SECURITY.md surface #9).
 *
 * The untrusted surface is the event title/description/location plus the editor
 * inputs. All view renderers interpolate those strings into `innerHTML`, so they
 * must be HTML-escaped (via the shared `escape` from @jects/core); the modal
 * editor must populate native inputs through `.value`/`textContent`, never markup.
 *
 * Each test injects the standard payloads and asserts: (1) a global flag stays
 * false (no `onerror`/`onload`/`alert` handler ever fires), (2) the rendered DOM
 * contains no `<script>`, no `on*` event-handler attributes, and no
 * `javascript:` URLs, and (3) legitimate text still renders verbatim.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Calendar } from './calendar.js';
import { openEventEditor } from './editor.js';
import type { CalendarEvent, CalendarViewType } from './contract.js';

declare global {
  // eslint-disable-next-line no-var
  var __xss: boolean;
}

const ANCHOR = new Date(2026, 5, 24); // Wed Jun 24 2026

// The standard payload battery. Each, if mis-handled, sets `window.__xss`.
const PAYLOADS = [
  '<img src=x onerror="window.__xss=true">',
  '<script>window.__xss=true</script>',
  '<svg onload="window.__xss=true"></svg>',
  '"><iframe src="javascript:window.__xss=true"></iframe>',
  '<a href="javascript:window.__xss=true">click</a>',
  '<img src="data:text/html,<script>window.__xss=true</script>">',
] as const;

const PAYLOAD = PAYLOADS.join(' ');

let host: HTMLElement;

function xssEvents(): CalendarEvent[] {
  return [
    {
      id: 'timed',
      title: PAYLOAD,
      location: PAYLOAD,
      description: PAYLOAD,
      start: new Date(2026, 5, 24, 9, 0),
      end: new Date(2026, 5, 24, 10, 0),
      categoryId: 'work',
      resourceId: 'room-a',
    },
    {
      id: 'allday',
      title: PAYLOAD,
      location: PAYLOAD,
      start: new Date(2026, 5, 24),
      end: new Date(2026, 5, 25),
      allDay: true,
      categoryId: 'work',
      resourceId: 'room-a',
    },
  ];
}

function mk(view: CalendarViewType): Calendar {
  return new Calendar(host, {
    date: ANCHOR,
    view,
    events: xssEvents(),
    categories: [{ id: 'work', name: 'Work', color: 'data-1' }],
    resources: [{ id: 'room-a', name: 'Room A' }],
  });
}

/** Assert the rendered subtree is free of executable injection vectors. */
function assertClean(root: HTMLElement): void {
  // No global handler fired during render.
  expect(window.__xss).toBe(false);
  // No injected script/iframe/svg-with-handlers smuggled into the DOM.
  expect(root.querySelector('script')).toBeNull();
  expect(root.querySelector('iframe')).toBeNull();
  // No element carries an on* event-handler attribute.
  for (const el of root.querySelectorAll('*')) {
    for (const attr of Array.from(el.attributes)) {
      expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
      if (attr.name === 'href' || attr.name === 'src') {
        expect(attr.value.toLowerCase()).not.toContain('javascript:');
      }
    }
  }
  // The literal markup must survive only as escaped text, never as live nodes:
  // an injected <img> from the payload would show up as an element node.
  expect(root.querySelector('img')).toBeNull();
}

beforeEach(() => {
  window.__xss = false;
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
  document.querySelectorAll('.jects-cal-editor-window').forEach((n) => n.remove());
});

describe('calendar XSS hardening', () => {
  for (const view of ['month', 'week', 'day', 'agenda', 'resource', 'timeline'] as const) {
    it(`escapes malicious event fields in the ${view} view`, () => {
      const cal = mk(view);
      assertClean(host);
      // Interact: switch back through views to exercise re-render paths.
      cal.setView('month');
      assertClean(host);
    });
  }

  it('renders legitimate text verbatim (escaping is lossless for plain text)', () => {
    const cal = new Calendar(host, {
      date: ANCHOR,
      view: 'agenda',
      events: [
        {
          id: 'ok',
          title: 'Team Lunch & Review',
          location: 'Room <A>',
          start: new Date(2026, 5, 24, 12, 0),
          end: new Date(2026, 5, 24, 13, 0),
          categoryId: 'work',
        },
      ],
      categories: [{ id: 'work', name: 'Work', color: 'data-1' }],
      resources: [],
    });
    const titleEl = host.querySelector('.jects-cal__agenda-title');
    expect(titleEl?.textContent).toBe('Team Lunch & Review');
    const locEl = host.querySelector('.jects-cal__agenda-loc');
    // The angle-bracketed location must be visible text, not a parsed element.
    expect(locEl?.textContent).toBe('Room <A>');
    expect(host.querySelector('a')).toBeNull();
    assertClean(host);
    cal.destroy();
  });

  it('editor populates native inputs as text, not markup', () => {
    const win = openEventEditor(host, {
      event: {
        id: 'e1',
        title: PAYLOAD,
        location: PAYLOAD,
        description: PAYLOAD,
        start: new Date(2026, 5, 24, 9, 0),
        end: new Date(2026, 5, 24, 10, 0),
      },
      defaultStart: new Date(2026, 5, 24, 9, 0),
      defaultEnd: new Date(2026, 5, 24, 10, 0),
      categories: [],
      resources: [],
      onSave: () => {},
    });
    const root = win.el as HTMLElement;
    // Payload round-trips as the literal input value (escaped, not executed).
    const title = root.querySelector<HTMLInputElement>('#jects-cal-title');
    expect(title?.value).toBe(PAYLOAD);
    const loc = root.querySelector<HTMLInputElement>('#jects-cal-loc');
    expect(loc?.value).toBe(PAYLOAD);
    const desc = root.querySelector<HTMLTextAreaElement>('#jects-cal-desc');
    expect(desc?.value).toBe(PAYLOAD);
    assertClean(root);
    win.destroy();
  });
});
