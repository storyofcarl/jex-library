import { describe, it, expect, vi } from 'vitest';
import { AjaxBookingDataProvider } from './data-provider.js';

/** Build a fake fetch that records calls and returns canned JSON. */
function fakeFetch(body: unknown, ok = true): typeof fetch {
  return vi.fn(async () =>
    ({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    }) as Response,
  ) as unknown as typeof fetch;
}

describe('AjaxBookingDataProvider', () => {
  it('loads availability with a range query', async () => {
    const fetchImpl = fakeFetch({ weekly: { 1: [{ start: '09:00', end: '17:00' }] } });
    const p = new AjaxBookingDataProvider({ url: 'https://api.test/', fetchImpl });
    const rules = await p.loadAvailability({ start: '2030-06-01', end: '2030-06-30' });
    expect(rules.weekly?.[1]).toEqual([{ start: '09:00', end: '17:00' }]);
    const calledUrl = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0];
    expect(String(calledUrl)).toContain('/availability?from=2030-06-01&to=2030-06-30');
  });

  it('loads bookings, unwrapping a { data } envelope', async () => {
    const rows = [{ id: '1', date: '2030-06-24', time: '09:00', duration: 30, status: 'confirmed' }];
    const p = new AjaxBookingDataProvider({ url: 'https://api.test', fetchImpl: fakeFetch({ data: rows }) });
    const out = await p.loadBookings({ start: '2030-06-01', end: '2030-06-30' });
    expect(out).toEqual(rows);
  });

  it('creates a booking via POST', async () => {
    const created = { id: '9', date: '2030-06-24', time: '09:00', duration: 30, status: 'confirmed' };
    const fetchImpl = fakeFetch(created);
    const p = new AjaxBookingDataProvider({ url: 'https://api.test', fetchImpl });
    const res = await p.createBooking({
      date: '2030-06-24',
      time: '09:00',
      duration: 30,
      details: { name: 'Ada', email: 'ada@example.com' },
    });
    expect(res).toEqual(created);
    const call = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect((call[1] as RequestInit).method).toBe('POST');
  });

  it('throws on a non-ok response', async () => {
    const p = new AjaxBookingDataProvider({ url: 'https://api.test', fetchImpl: fakeFetch(null, false) });
    await expect(p.cancelBooking('1')).rejects.toThrow();
  });

  it('subscribe wires a WebSocket and decodes ops', () => {
    const handlers: Record<string, (ev: { data: string }) => void> = {};
    class FakeWS {
      constructor(public url: string) {}
      addEventListener(type: string, fn: (ev: { data: string }) => void): void {
        handlers[type] = fn;
      }
      removeEventListener(): void {}
      close(): void {}
    }
    const p = new AjaxBookingDataProvider({
      url: 'https://api.test',
      wsUrl: 'wss://api.test/ws',
      webSocketImpl: FakeWS as unknown as typeof WebSocket,
    });
    const onRemote = vi.fn();
    const unsub = p.subscribe(onRemote);
    handlers.message!({ data: JSON.stringify({ action: 'remove', id: '1' }) });
    expect(onRemote).toHaveBeenCalledWith({ action: 'remove', id: '1' });
    // Malformed payloads are ignored.
    handlers.message!({ data: 'not json' });
    expect(onRemote).toHaveBeenCalledTimes(1);
    unsub();
  });
});
