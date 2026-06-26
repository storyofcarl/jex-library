/**
 * `@jects/vue/calendar` — typed Vue 3 binding for {@link Calendar} only.
 *
 * Imports only the shared factory and the `@jects/calendar` engine.
 */
import { createComponent } from './factory.js';
import { Calendar, type CalendarConfig, type CalendarEvents } from '@jects/calendar';

export const JectsCalendar = createComponent<Calendar, CalendarConfig, CalendarEvents>(Calendar);

export type { CalendarConfig, CalendarEvents };
