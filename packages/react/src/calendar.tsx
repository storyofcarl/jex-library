/**
 * `@jects/react/calendar` — isolated React binding for the Jects Calendar engine.
 *
 * Importing this entry pulls in ONLY `@jects/calendar` (plus the shared factory and
 * React), never any sibling engine.
 */
import { Calendar, type CalendarConfig, type CalendarEvents } from '@jects/calendar';
import { createComponent } from './factory.js';

export const JectsCalendar = createComponent<Calendar, CalendarConfig, CalendarEvents>(Calendar);
export type { CalendarConfig, CalendarEvents };
