/**
 * `@jects/react/booking` — isolated React binding for the Jects Booking engine.
 *
 * Importing this entry pulls in ONLY `@jects/booking` (plus the shared factory and
 * React), never any sibling engine.
 */
import { Booking, type BookingConfig, type BookingEvents } from '@jects/booking';
import { createComponent } from './factory.js';

export const JectsBooking = createComponent<Booking, BookingConfig, BookingEvents>(Booking);
export type { BookingConfig, BookingEvents };
