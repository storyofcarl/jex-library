import { describe, it, expect } from 'vitest';
import {
  buildColumnStats,
  evaluateConditional,
  type ConditionalContext,
  type ConditionalRule,
} from './conditional.js';
import type { PivotColumnLeaf } from './engine.js';

const leaf: PivotColumnLeaf = {
  path: ['Q1'],
  keyPath: ['Q1'],
  valueIndex: 0,
  valueLabel: 'Sum of amount',
  valueField: 'amount',
  key: 'q1-0',
};

function ctx(value: number | null, over: Partial<ConditionalContext> = {}): ConditionalContext {
  return { value, field: 'amount', rowKey: ['West'], colKey: ['Q1'], leaf, isTotal: false, ...over };
}

describe('evaluateConditional — callback form', () => {
  it('returns whatever the callback emits', () => {
    const out = evaluateConditional(
      (c) => (c.value != null && c.value > 100 ? { class: 'hot', style: { color: 'red' } } : null),
      ctx(150),
    );
    expect(out).toEqual({ class: 'hot', style: { color: 'red' } });
    expect(evaluateConditional(() => null, ctx(1))).toBeNull();
  });

  it('passes the cell identity to the callback', () => {
    let seen: ConditionalContext | undefined;
    evaluateConditional((c) => {
      seen = c;
      return null;
    }, ctx(42));
    expect(seen?.field).toBe('amount');
    expect(seen?.rowKey).toEqual(['West']);
    expect(seen?.colKey).toEqual(['Q1']);
  });
});

describe('evaluateConditional — cellValue rule', () => {
  const rules: ConditionalRule[] = [
    { kind: 'cellValue', op: 'gt', value: 100, class: 'jects-pivot__cf--highlight' },
  ];
  it('applies the class when the predicate holds', () => {
    expect(evaluateConditional(rules, ctx(150))?.class).toBe('jects-pivot__cf--highlight');
    expect(evaluateConditional(rules, ctx(50))).toBeNull();
    expect(evaluateConditional(rules, ctx(null))).toBeNull();
  });

  it('honors the between operator and field scoping', () => {
    const scoped: ConditionalRule[] = [
      { kind: 'cellValue', op: 'between', value: 10, value2: 20, field: 'amount', style: { fontWeight: 'bold' } },
    ];
    expect(evaluateConditional(scoped, ctx(15))?.style).toEqual({ fontWeight: 'bold' });
    expect(evaluateConditional(scoped, ctx(25))).toBeNull();
    // Different field → rule does not apply.
    expect(evaluateConditional(scoped, ctx(15, { field: 'units' }))).toBeNull();
  });
});

describe('evaluateConditional — colorScale + dataBar', () => {
  const stats = buildColumnStats(['q1-0'], [{ 'q1-0': 0 }, { 'q1-0': 100 }, { 'q1-0': 50 }]);

  it('interpolates a background color across the column min..max', () => {
    const rule: ConditionalRule[] = [{ kind: 'colorScale', min: '#ffffff', max: '#000000' }];
    const lo = evaluateConditional(rule, ctx(0), stats);
    const hi = evaluateConditional(rule, ctx(100), stats);
    expect(lo?.style?.['background-color']).toBe('rgb(255, 255, 255)');
    expect(hi?.style?.['background-color']).toBe('rgb(0, 0, 0)');
  });

  it('renders a proportional data bar gradient', () => {
    const rule: ConditionalRule[] = [{ kind: 'dataBar', color: '#3366ff' }];
    const mid = evaluateConditional(rule, ctx(50), stats);
    expect(mid?.style?.['backgroundImage']).toContain('50%');
    expect(mid?.style?.['backgroundImage']).toContain('#3366ff');
  });
});
