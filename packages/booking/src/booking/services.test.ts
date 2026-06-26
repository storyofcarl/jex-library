import { describe, it, expect } from 'vitest';
import {
  findService,
  serviceConstraints,
  formatPrice,
  type BookingService,
} from './services.js';

const services: BookingService[] = [
  { id: 'cut', name: 'Haircut', duration: 30, price: 40 },
  {
    id: 'color',
    name: 'Coloring',
    duration: 90,
    bufferAfter: 15,
    minNotice: 120,
    maxHorizonDays: 60,
    capacity: 2,
  },
];

describe('findService', () => {
  it('finds by id, undefined otherwise', () => {
    expect(findService(services, 'color')?.name).toBe('Coloring');
    expect(findService(services, 'nope')).toBeUndefined();
    expect(findService(undefined, 'cut')).toBeUndefined();
  });
});

describe('serviceConstraints', () => {
  it('extracts only the constraints that are set', () => {
    expect(serviceConstraints(services[0]!)).toEqual({ slotDuration: 30 });
    expect(serviceConstraints(services[1]!)).toEqual({
      slotDuration: 90,
      bufferAfter: 15,
      minNotice: 120,
      maxHorizonDays: 60,
      capacity: 2,
    });
  });
});

describe('formatPrice', () => {
  it('formats currency and falls back on bad codes', () => {
    expect(formatPrice(40, 'USD', 'en-US')).toBe('$40.00');
    expect(formatPrice(40, 'NOTACODE')).toBe('40 NOTACODE');
  });
});
