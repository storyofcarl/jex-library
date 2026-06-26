/**
 * services — multiple SERVICES (event types). Each service carries its own
 * duration, price, pre/post buffer (padding), minimum scheduling notice, maximum
 * booking horizon, seat capacity and per-service intake form fields. The booking
 * flow gains a service-selection step; the slot engine reads the selected
 * service's constraints. Dependency-free and unit-tested.
 */

import type { BookingFieldSchema } from './booking.js';

/** A bookable service / event type. */
export interface BookingService {
  /** Stable id, written onto created bookings + used to scope availability. */
  id: string;
  /** Visible label. */
  name: string;
  /** Duration in minutes. */
  duration: number;
  /** Optional price (in `currency` minor→major units, plain number). */
  price?: number;
  /** ISO-4217 currency code for `price` (default `'USD'`). */
  currency?: string;
  /** Padding (minutes) reserved BEFORE the appointment. */
  bufferBefore?: number;
  /** Padding (minutes) reserved AFTER the appointment. */
  bufferAfter?: number;
  /** Minimum advance notice (minutes from now) required to book. */
  minNotice?: number;
  /** Maximum booking horizon in days from now. */
  maxHorizonDays?: number;
  /** Seats per slot (group/class bookings). Default 1. */
  capacity?: number;
  /** Whether a full slot offers a waitlist. */
  waitlist?: boolean;
  /** Short description shown under the service name. */
  description?: string;
  /** Per-service intake form fields (appended after name/email/notes). */
  fields?: BookingFieldSchema[];
}

/** Find a service by id. */
export function findService(
  services: BookingService[] | undefined,
  id: string | undefined,
): BookingService | undefined {
  if (!services || id == null) return undefined;
  return services.find((s) => s.id === id);
}

/** The slot-engine constraints a service imposes (all optional). */
export interface ServiceConstraints {
  slotDuration: number;
  bufferBefore?: number;
  bufferAfter?: number;
  minNotice?: number;
  maxHorizonDays?: number;
  capacity?: number;
}

/** Extract the slot-engine constraints from a service. */
export function serviceConstraints(service: BookingService): ServiceConstraints {
  const out: ServiceConstraints = { slotDuration: service.duration };
  if (service.bufferBefore != null) out.bufferBefore = service.bufferBefore;
  if (service.bufferAfter != null) out.bufferAfter = service.bufferAfter;
  if (service.minNotice != null) out.minNotice = service.minNotice;
  if (service.maxHorizonDays != null) out.maxHorizonDays = service.maxHorizonDays;
  if (service.capacity != null) out.capacity = service.capacity;
  return out;
}

/**
 * Format a price using `Intl.NumberFormat` currency style; falls back to a plain
 * number when the currency code is unknown to the runtime.
 */
export function formatPrice(price: number, currency = 'USD', locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(price);
  } catch {
    return `${price} ${currency}`;
  }
}
