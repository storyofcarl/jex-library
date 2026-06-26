/**
 * `@jects/vue/booking` — typed Vue 3 binding for {@link Booking} only.
 *
 * Imports only the shared factory and the `@jects/booking` engine.
 */
import { createComponent } from './factory.js';
import { Booking, type BookingConfig, type BookingEvents } from '@jects/booking';

export const JectsBooking = createComponent<Booking, BookingConfig, BookingEvents>(Booking);

export type { BookingConfig, BookingEvents };
