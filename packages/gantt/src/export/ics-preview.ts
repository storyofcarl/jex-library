/**
 * `@jects/gantt` — accessible ICS export *preview* (DOM, token-pure CSS).
 *
 * The {@link tasksToIcs} serializer is pure/DOM-free; this thin presentational
 * helper renders the parsed events as an accessible HTML table so the export can
 * be reviewed before download and so the a11y/visual browser test has a real,
 * screen-reader-operable surface to assert against. It does NOT extend `Widget`
 * (it is a plain build helper, like the export modules) — the Gantt widget can
 * mount it inside an export dialog; see the wire notes.
 *
 * Parsing is deliberately minimal (unfold CRLF continuations, then read the
 * VEVENT blocks we ourselves emit) so the preview always matches the produced
 * file without re-deriving anything from the task store.
 */

import { ICS_PREVIEW_STYLE } from './ics-preview.css.js';

/** A parsed VEVENT, reduced to the fields the preview shows. */
export interface IcsPreviewEvent {
  uid: string;
  summary: string;
  start: string;
  end?: string;
  milestone: boolean;
  percentComplete?: string;
}

/** Unfold RFC-5545 line folding: a CRLF followed by a single space/TAB. */
export function unfoldIcs(ics: string): string[] {
  return ics
    .replace(/\r\n[ \t]/g, '')
    .split(/\r\n|\n/)
    .filter((l) => l.length > 0);
}

/** Reverse {@link escapeIcsText} for display (`\n \; \, \\` → literals). */
function unescapeIcsText(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === '\\' && i + 1 < value.length) {
      const n = value[++i]!;
      out += n === 'n' || n === 'N' ? '\n' : n;
    } else {
      out += c;
    }
  }
  return out;
}

/** Split a content line into `NAME[;params]` and `value`. */
function splitProp(line: string): { name: string; value: string } {
  const idx = line.indexOf(':');
  if (idx < 0) return { name: line, value: '' };
  const left = line.slice(0, idx);
  const name = left.split(';')[0]!;
  return { name, value: line.slice(idx + 1) };
}

/** Parse the VEVENT blocks out of an ICS document we produced. */
export function parseIcsEvents(ics: string): IcsPreviewEvent[] {
  const lines = unfoldIcs(ics);
  const events: IcsPreviewEvent[] = [];
  let cur: Partial<IcsPreviewEvent> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = { milestone: false };
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur) {
        events.push({
          uid: cur.uid ?? '',
          summary: cur.summary ?? '',
          start: cur.start ?? '',
          ...(cur.end !== undefined ? { end: cur.end } : {}),
          milestone: cur.milestone ?? false,
          ...(cur.percentComplete !== undefined
            ? { percentComplete: cur.percentComplete }
            : {}),
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const { name, value } = splitProp(line);
    switch (name) {
      case 'UID':
        cur.uid = value;
        break;
      case 'SUMMARY':
        cur.summary = unescapeIcsText(value);
        break;
      case 'DTSTART':
        cur.start = value;
        break;
      case 'DTEND':
        cur.end = value;
        break;
      case 'CATEGORIES':
        if (value.split(',').includes('MILESTONE')) cur.milestone = true;
        break;
      case 'PERCENT-COMPLETE':
        cur.percentComplete = value;
        break;
      default:
        break;
    }
  }
  return events;
}

let styleInjected = false;

/** Inject the token-pure preview stylesheet once (idempotent). */
function ensureStyle(doc: Document): void {
  if (styleInjected || doc.getElementById('jects-gantt-ics-preview-style')) {
    styleInjected = true;
    return;
  }
  const el = doc.createElement('style');
  el.id = 'jects-gantt-ics-preview-style';
  el.textContent = ICS_PREVIEW_STYLE;
  doc.head.appendChild(el);
  styleInjected = true;
}

/** Options for {@link renderIcsPreview}. */
export interface IcsPreviewOptions {
  /** Accessible caption / heading for the table. Default `"Calendar export preview"`. */
  caption?: string;
}

/**
 * Render an ICS document into an accessible preview element: a captioned
 * `<table>` (one row per VEVENT) with a column-scoped header row, plus a count
 * summary. The element carries `role="group"` and an `aria-label` so it reads as
 * one labelled region. Returns the root element (caller owns mounting/removal).
 */
export function renderIcsPreview(
  ics: string,
  options: IcsPreviewOptions = {},
  doc: Document = document,
): HTMLElement {
  ensureStyle(doc);
  const events = parseIcsEvents(ics);
  const caption = options.caption ?? 'Calendar export preview';

  const root = doc.createElement('div');
  root.className = 'jects-gantt-ics-preview';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', caption);

  const summary = doc.createElement('p');
  summary.className = 'jects-gantt-ics-preview__summary';
  summary.textContent = `${events.length} event${events.length === 1 ? '' : 's'} ready to export`;
  root.appendChild(summary);

  const table = doc.createElement('table');
  table.className = 'jects-gantt-ics-preview__table';

  const cap = doc.createElement('caption');
  cap.className = 'jects-gantt-ics-preview__caption';
  cap.textContent = caption;
  table.appendChild(cap);

  const thead = doc.createElement('thead');
  const hr = doc.createElement('tr');
  for (const h of ['Event', 'Start', 'End', 'Complete']) {
    const th = doc.createElement('th');
    th.scope = 'col';
    th.textContent = h;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = doc.createElement('tbody');
  for (const ev of events) {
    const tr = doc.createElement('tr');
    tr.className = 'jects-gantt-ics-preview__row';
    if (ev.milestone) tr.classList.add('jects-gantt-ics-preview__row--milestone');
    tr.dataset.uid = ev.uid;

    const name = doc.createElement('th');
    name.scope = 'row';
    name.className = 'jects-gantt-ics-preview__name';
    if (ev.milestone) {
      const badge = doc.createElement('span');
      badge.className = 'jects-gantt-ics-preview__milestone';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = '◆';
      name.appendChild(badge);
      name.appendChild(doc.createTextNode(' '));
    }
    name.appendChild(doc.createTextNode(ev.summary || ev.uid));
    tr.appendChild(name);

    const start = doc.createElement('td');
    start.textContent = ev.start;
    tr.appendChild(start);

    const end = doc.createElement('td');
    end.textContent = ev.milestone ? '—' : (ev.end ?? '');
    if (ev.milestone) end.setAttribute('aria-label', 'milestone (no end)');
    tr.appendChild(end);

    const pct = doc.createElement('td');
    pct.textContent = ev.percentComplete != null ? `${ev.percentComplete}%` : '';
    tr.appendChild(pct);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  root.appendChild(table);

  return root;
}
