import { describe, it, expect } from 'vitest';
import { schedule } from './scheduling-engine.js';
import type { EventModel, DependencyModel } from '../contract.js';

const DAY = 86_400_000;
// A Monday 09:00 UTC so working-time math stays inside a working week.
const MON_9 = Date.UTC(2025, 0, 6, 9); // 2025-01-06 is a Monday

function evt(id: string, start: number, hours: number): EventModel {
  return { id, resourceId: 'r', startDate: start, endDate: start + hours * 3_600_000 };
}

describe('scheduling engine', () => {
  it('returns no changes when there are no dependencies', () => {
    const events = [evt('a', MON_9, 2), evt('b', MON_9 + DAY, 2)];
    expect(schedule({ events, dependencies: [] })).toEqual([]);
  });

  it('pushes an FS successor to start after its predecessor finishes', () => {
    // b overlaps a; an FS link should move b to start at/after a's finish.
    const a = evt('a', MON_9, 4); // Mon 9–13
    const b = evt('b', MON_9, 2); // also Mon 9–11 (overlaps)
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    const result = schedule({ events: [a, b], dependencies: deps });
    const movedB = result.find((r) => r.id === 'b');
    expect(movedB).toBeDefined();
    // b's new start must be >= a's finish.
    expect(movedB!.startDate).toBeGreaterThanOrEqual(a.endDate);
  });

  it('preserves working duration across the move', () => {
    const a = evt('a', MON_9, 4);
    const b = evt('b', MON_9, 3); // 3 working hours
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    const [movedB] = schedule({ events: [a, b], dependencies: deps }).filter((r) => r.id === 'b');
    // Roughly 3 hours of working time (allow minute-resolution rounding).
    const dur = movedB!.endDate - movedB!.startDate;
    expect(dur).toBeGreaterThanOrEqual(3 * 3_600_000 - 60_000);
  });

  it('breaks cycles without looping forever', () => {
    const a = evt('a', MON_9, 2);
    const b = evt('b', MON_9, 2);
    const deps: DependencyModel[] = [
      { id: 'd1', fromId: 'a', toId: 'b', type: 'FS' },
      { id: 'd2', fromId: 'b', toId: 'a', type: 'FS' },
    ];
    // Should terminate and return an array (cycle back-edge ignored).
    expect(Array.isArray(schedule({ events: [a, b], dependencies: deps }))).toBe(true);
  });

  it('applies a startnoearlierthan constraint', () => {
    const a = evt('a', MON_9, 2);
    a.constraintType = 'startnoearlierthan';
    a.constraintDate = MON_9 + DAY; // not before next day
    const [moved] = schedule({ events: [a], dependencies: [] });
    expect(moved).toBeDefined();
    expect(moved!.startDate).toBeGreaterThanOrEqual(MON_9 + DAY);
  });

  it('schedules backward (successor drives predecessor)', () => {
    const a = evt('a', MON_9, 2);
    const b = evt('b', MON_9 + DAY * 3, 2);
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    const result = schedule({ events: [a, b], dependencies: deps, direction: 'backward' });
    const movedA = result.find((r) => r.id === 'a');
    if (movedA) expect(movedA.endDate).toBeLessThanOrEqual(b.startDate);
  });

  it('FF constrains the successor FINISH, not its start', () => {
    // a: Mon 9–13 (4h). FF: b.finish >= a.finish. b is 2h → b must finish at a's
    // finish (≈13:00), i.e. START around 11:00 — NOT start at a's finish (13:00).
    const a = evt('a', MON_9, 4);
    const b = evt('b', MON_9, 2);
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FF' }];
    const [movedB] = schedule({ events: [a, b], dependencies: deps }).filter((r) => r.id === 'b');
    expect(movedB).toBeDefined();
    // Finish aligns with a's finish (within minute resolution)…
    expect(Math.abs(movedB!.endDate - a.endDate)).toBeLessThanOrEqual(60_000);
    // …and the start is BEFORE a's finish (the old bug started b at a.finish).
    expect(movedB!.startDate).toBeLessThan(a.endDate);
  });

  it('SF aligns the successor FINISH to the driver start, not its start', () => {
    // SF: b.finish >= a.start. a starts mid-day Tue 11:00 (unambiguous boundary),
    // b is 2h originally Mon 9–11 (finishes well before a.start). The constraint
    // must push b's FINISH to a.start (Tue 11:00), i.e. b runs Tue 09:00–11:00 —
    // NOT push b's START to a.start (the old start-bound bug would give Tue 11–13).
    const a = evt('a', MON_9 + DAY + 2 * 3_600_000, 4); // Tue 11–15
    const b = evt('b', MON_9, 2); // Mon 9–11
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'SF' }];
    const [movedB] = schedule({ events: [a, b], dependencies: deps }).filter((r) => r.id === 'b');
    expect(movedB).toBeDefined();
    // Finish aligns with a's start (within minute resolution)…
    expect(Math.abs(movedB!.endDate - a.startDate)).toBeLessThanOrEqual(60_000);
    // …and the start is BEFORE a's start (the old bug started b at a.start).
    expect(movedB!.startDate).toBeLessThan(a.startDate);
  });

  it('a must-start constraint cannot violate an FS predecessor floor', () => {
    // a: Mon 9–13. b FS-depends on a (must start >= 13:00) but also carries a
    // muststarton of Mon 9:00 (earlier than a's finish). Precedence must win:
    // b may not start before a finishes.
    const a = evt('a', MON_9, 4);
    const b = evt('b', MON_9 + DAY, 2);
    b.constraintType = 'muststarton';
    b.constraintDate = MON_9; // earlier than a's finish (13:00)
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    const result = schedule({ events: [a, b], dependencies: deps });
    const movedB = result.find((r) => r.id === 'b') ?? { startDate: b.startDate, endDate: b.endDate };
    expect(movedB.startDate).toBeGreaterThanOrEqual(a.endDate);
  });
});
