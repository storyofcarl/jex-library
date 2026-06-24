/**
 * Icon path data. Each entry is the inner markup of a 24×24 stroke icon
 * (stroke-based, `currentColor`). Lucide-compatible geometry.
 */

export interface IconDef {
  /** viewBox dimension (square). */
  readonly size: 24;
  /** Inner SVG markup (paths/lines/circles), no <svg> wrapper. */
  readonly body: string;
}

const icon = (body: string): IconDef => ({ size: 24, body });

export const icons = {
  'chevron-up': icon('<path d="m18 15-6-6-6 6"/>'),
  'chevron-down': icon('<path d="m6 9 6 6 6-6"/>'),
  'chevron-left': icon('<path d="m15 18-6-6 6-6"/>'),
  'chevron-right': icon('<path d="m9 18 6-6-6-6"/>'),
  'chevrons-up-down': icon('<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>'),
  close: icon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  check: icon('<path d="M20 6 9 17l-5-5"/>'),
  'check-circle': icon(
    '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  ),
  search: icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  calendar: icon(
    '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 2v4"/><path d="M16 2v4"/>',
  ),
  clock: icon('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  plus: icon('<path d="M5 12h14"/><path d="M12 5v14"/>'),
  minus: icon('<path d="M5 12h14"/>'),
  x: icon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  menu: icon('<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>'),
  'more-horizontal': icon(
    '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  ),
  'more-vertical': icon(
    '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
  ),
  filter: icon('<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>'),
  'arrow-up': icon('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>'),
  'arrow-down': icon('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>'),
  info: icon('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  'alert-triangle': icon(
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  ),
  trash: icon(
    '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  ),
  edit: icon(
    '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
  ),
  'loader': icon(
    '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  ),
} as const satisfies Record<string, IconDef>;

export type IconName = keyof typeof icons;

/** All available icon names. */
export const iconNames = Object.keys(icons) as IconName[];
