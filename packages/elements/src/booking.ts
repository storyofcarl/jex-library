/**
 * `@jects/elements/booking` — the `<jects-booking>` custom element only.
 * Importing this entry pulls ONLY `@jects/booking` plus the engine-free shared factory.
 */
import { Booking, type BookingConfig, type BookingEvents } from '@jects/booking';
import { createComponent, defineElements, type JectsElementDefinition } from './shared.js';

export const JectsBookingElement = createComponent<Booking, BookingConfig, BookingEvents>(Booking);

/** The `<jects-booking>` tag paired with its element class. */
export const bookingElementDefinition: JectsElementDefinition = {
  tag: 'jects-booking',
  ctor: JectsBookingElement,
};

/** Define `<jects-booking>` into a registry (defaults to the global `customElements`). Idempotent. */
export function registerBooking(target?: CustomElementRegistry): void {
  defineElements([bookingElementDefinition], target);
}

export {
  createComponent,
  type JectsElement,
  type JectsElementConstructor,
  type JectsElementDefinition,
} from './shared.js';
export type { BookingConfig, BookingEvents };
