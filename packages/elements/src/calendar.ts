/**
 * `@jects/elements/calendar` — the `<jects-calendar>` custom element only.
 * Importing this entry pulls ONLY `@jects/calendar` plus the engine-free shared factory.
 */
import { Calendar, type CalendarConfig, type CalendarEvents } from '@jects/calendar';
import { createComponent, defineElements, type JectsElementDefinition } from './shared.js';

export const JectsCalendarElement = createComponent<Calendar, CalendarConfig, CalendarEvents>(
  Calendar,
);

/** The `<jects-calendar>` tag paired with its element class. */
export const calendarElementDefinition: JectsElementDefinition = {
  tag: 'jects-calendar',
  ctor: JectsCalendarElement,
};

/** Define `<jects-calendar>` into a registry (defaults to the global `customElements`). Idempotent. */
export function registerCalendar(target?: CustomElementRegistry): void {
  defineElements([calendarElementDefinition], target);
}

export {
  createComponent,
  type JectsElement,
  type JectsElementConstructor,
  type JectsElementDefinition,
} from './shared.js';
export type { CalendarConfig, CalendarEvents };
