import { describe, it, expect } from 'vitest';
import {
  WaitlistManager,
  slotKeyId,
  sameSlot,
  countSeatsBooked,
  seatsRemaining,
  type SlotKey,
} from './capacity.js';

const key: SlotKey = { date: '2030-06-24', time: '09:00' };
const details = { name: 'Ada', email: 'ada@example.com' };

describe('slot key helpers', () => {
  it('builds a stable resource-scoped id', () => {
    expect(slotKeyId({ date: '2030-06-24', time: '09:00', resourceId: 'r1' })).toBe(
      '2030-06-24T09:00#r1',
    );
    expect(sameSlot(key, { date: '2030-06-24', time: '09:00' })).toBe(true);
    expect(sameSlot(key, { date: '2030-06-24', time: '10:00' })).toBe(false);
  });
});

describe('seat counting', () => {
  const bookings = [
    { date: '2030-06-24', time: '09:00' },
    { date: '2030-06-24', time: '09:00' },
    { date: '2030-06-24', time: '10:00' },
  ];
  it('counts booked seats for a slot', () => {
    expect(countSeatsBooked(bookings, key)).toBe(2);
  });
  it('computes seats remaining clamped at 0', () => {
    expect(seatsRemaining(5, bookings, key)).toBe(3);
    expect(seatsRemaining(1, bookings, key)).toBe(0);
  });
  it('scopes by resource when set', () => {
    const b = [
      { date: '2030-06-24', time: '09:00', resourceId: 'a' },
      { date: '2030-06-24', time: '09:00', resourceId: 'b' },
    ];
    expect(countSeatsBooked(b, { ...key, resourceId: 'a' })).toBe(1);
  });
});

describe('WaitlistManager', () => {
  it('adds, lists FIFO, and promotes the oldest', () => {
    const wl = new WaitlistManager();
    const first = wl.add(key, details);
    const second = wl.add(key, { name: 'Bob', email: 'bob@example.com' });
    expect(wl.countForSlot(key)).toBe(2);
    expect(wl.forSlot(key).map((e) => e.id)).toEqual([first.id, second.id]);

    const promoted = wl.promoteNext(key);
    expect(promoted?.id).toBe(first.id);
    expect(wl.countForSlot(key)).toBe(1);

    expect(wl.promoteNext(key)?.id).toBe(second.id);
    expect(wl.promoteNext(key)).toBeNull();
  });
  it('remove returns whether something was removed', () => {
    const wl = new WaitlistManager();
    const e = wl.add(key, details);
    expect(wl.remove(e.id)).toBe(true);
    expect(wl.remove(e.id)).toBe(false);
  });
});
