/**
 * `@jects/angular/calendar` — typed Angular standalone binding for the {@link Calendar} engine.
 *
 * Importing this subpath pulls in `@jects/calendar` and the shared factory only, never a
 * sibling engine. Use the root `@jects/angular` entry for the whole suite.
 */
import { createComponent } from './factory.js';
import { Calendar, type CalendarConfig, type CalendarEvents } from '@jects/calendar';

export const JectsCalendar = createComponent<Calendar, CalendarConfig, CalendarEvents>(Calendar, {
  selector: 'jects-calendar',
});

export type { CalendarConfig, CalendarEvents };
