import { describe, it, expect, vi } from 'vitest';
import { BookingManager } from './booking-manager.js';

function make(): BookingManager {
  return new BookingManager([
    { id: '1', date: '2030-06-24', time: '09:00', duration: 30, status: 'confirmed' },
    { id: '2', date: '2030-06-24', time: '10:00', duration: 30, status: 'pending' },
  ]);
}

describe('BookingManager', () => {
  it('lists, filters by status, and gets by id', () => {
    const m = make();
    expect(m.list().length).toBe(2);
    expect(m.list('pending').map((b) => b.id)).toEqual(['2']);
    expect(m.get('1')?.time).toBe('09:00');
  });

  it('adds (defaulting to confirmed) and emits', () => {
    const m = make();
    const spy = vi.fn();
    m.on('add', spy);
    const row = m.add({ id: '3', date: '2030-06-25', time: '11:00', duration: 30 });
    expect(row.status).toBe('confirmed');
    expect(m.list().length).toBe(3);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('cancels (soft) and changes status', () => {
    const m = make();
    const spy = vi.fn();
    m.on('cancel', spy);
    const updated = m.cancel('1');
    expect(updated?.status).toBe('cancelled');
    expect(m.get('1')?.status).toBe('cancelled');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('reschedules and reports the previous slot', () => {
    const m = make();
    const spy = vi.fn();
    m.on('reschedule', spy);
    m.reschedule('1', { date: '2030-06-26', time: '14:00' });
    expect(m.get('1')).toMatchObject({ date: '2030-06-26', time: '14:00' });
    expect(spy.mock.calls[0]![0].from).toMatchObject({ date: '2030-06-24', time: '09:00' });
  });

  it('setStatus + remove + parse', () => {
    const m = make();
    expect(m.setStatus('2', 'confirmed')?.status).toBe('confirmed');
    expect(m.remove('2')).toBe(true);
    expect(m.list().length).toBe(1);
    m.parse([{ id: 'x', date: '2030-07-01', time: '08:00', duration: 60, status: 'confirmed' }]);
    expect(m.list().map((b) => b.id)).toEqual(['x']);
  });
});
