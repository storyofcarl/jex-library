/**
 * `@jects/angular/booking` — typed Angular standalone binding for the {@link Booking} engine.
 *
 * Importing this subpath pulls in `@jects/booking` and the shared factory only, never a
 * sibling engine. Use the root `@jects/angular` entry for the whole suite.
 */
import { createComponent } from './factory.js';
import { Booking, type BookingConfig, type BookingEvents } from '@jects/booking';

export const JectsBooking = createComponent<Booking, BookingConfig, BookingEvents>(Booking, {
  selector: 'jects-booking',
});

export type { BookingConfig, BookingEvents };
