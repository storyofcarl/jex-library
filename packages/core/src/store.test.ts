import { describe, it, expect, vi } from 'vitest';
import { Store } from './store.js';

interface Row extends Record<string, unknown> {
  id: number;
  name: string;
  age: number;
}

const seed = (): Row[] => [
  { id: 1, name: 'Alice', age: 30 },
  { id: 2, name: 'Bob', age: 25 },
  { id: 3, name: 'Carol', age: 35 },
];

describe('Store', () => {
  it('loads initial data and indexes by id', () => {
    const s = new Store<Row>({ data: seed() });
    expect(s.count).toBe(3);
    expect(s.getById(2)?.name).toBe('Bob');
    expect(s.indexOf(3)).toBe(2);
  });

  it('add appends and emits', () => {
    const s = new Store<Row>({ data: seed() });
    const spy = vi.fn();
    s.events.on('add', spy);
    s.add({ id: 4, name: 'Dan', age: 40 });
    expect(s.count).toBe(4);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('remove deletes by id', () => {
    const s = new Store<Row>({ data: seed() });
    s.remove(2);
    expect(s.count).toBe(2);
    expect(s.getById(2)).toBeUndefined();
  });

  it('update merges changes', () => {
    const s = new Store<Row>({ data: seed() });
    s.update(1, { age: 31 });
    expect(s.getById(1)?.age).toBe(31);
  });

  it('move reorders', () => {
    const s = new Store<Row>({ data: seed() });
    s.move(0, 2);
    expect(s.getAt(2)?.id).toBe(1);
  });

  it('changeId reindexes', () => {
    const s = new Store<Row>({ data: seed() });
    s.changeId(1, 99);
    expect(s.getById(99)?.name).toBe('Alice');
    expect(s.getById(1)).toBeUndefined();
  });

  it('sort by field asc/desc', () => {
    const s = new Store<Row>({ data: seed() });
    s.sort('age', 'asc');
    expect(s.map((r) => r.age)).toEqual([25, 30, 35]);
    s.sort('age', 'desc');
    expect(s.map((r) => r.age)).toEqual([35, 30, 25]);
  });

  it('sort by comparator', () => {
    const s = new Store<Row>({ data: seed() });
    s.sort((a, b) => a.name.localeCompare(b.name));
    expect(s.map((r) => r.name)).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('filter predicate reduces the view; clearFilters restores', () => {
    const s = new Store<Row>({ data: seed() });
    s.filter((r) => r.age >= 30);
    expect(s.count).toBe(2);
    expect(s.totalCount).toBe(3);
    s.clearFilters();
    expect(s.count).toBe(3);
  });

  it('filter config with operator', () => {
    const s = new Store<Row>({ data: seed() });
    s.filter({ field: 'name', operator: 'startsWith', value: 'b' });
    expect(s.count).toBe(1);
    expect(s.getAt(0)?.name).toBe('Bob');
  });

  it('group buckets by field', () => {
    const s = new Store<Row>({
      data: [
        { id: 1, name: 'A', age: 30 },
        { id: 2, name: 'B', age: 30 },
        { id: 3, name: 'C', age: 40 },
      ],
    });
    const groups = s.group('age');
    expect(groups.get(30)?.length).toBe(2);
    expect(groups.get(40)?.length).toBe(1);
  });

  it('serialize returns plain copies', () => {
    const s = new Store<Row>({ data: seed() });
    const out = s.serialize();
    expect(out).toHaveLength(3);
    out[0]!.name = 'mutated';
    expect(s.getById(1)?.name).toBe('Alice');
  });

  it('applies model normalizer', () => {
    const s = new Store<Row>({
      data: [{ id: 1, name: 'lower', age: 1 }],
      model: (raw) => ({ ...(raw as Row), name: (raw.name as string).toUpperCase() }),
    });
    expect(s.getById(1)?.name).toBe('LOWER');
  });
});
