/**
 * jsdom unit tests for the dependency-notation parser/serializer — the pure
 * Bryntum/DHTMLX predecessors/successors notation round-trip. No DOM is needed;
 * these cover term splitting, type/lag parsing, ref resolution, error reporting,
 * serialization, and the add/remove diff.
 */
import { describe, it, expect } from 'vitest';
import {
  parseDependencyNotation,
  parseLag,
  serializeDependencyTerm,
  serializeDependencyTerms,
  formatLag,
  diffDependencyTerms,
} from './dependency-notation.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;

describe('parseLag', () => {
  it('parses signed day/hour/week lags and bare numbers', () => {
    expect(parseLag('+1d')).toBe(DAY);
    expect(parseLag('-2d')).toBe(-2 * DAY);
    expect(parseLag('3')).toBe(3 * DAY);
    expect(parseLag('+2h')).toBe(2 * HOUR);
    expect(parseLag('1w')).toBe(5 * DAY);
    expect(parseLag('2mo')).toBe(40 * DAY);
    expect(parseLag('')).toBe(0);
  });

  it('returns null for malformed lag', () => {
    expect(parseLag('abc')).toBeNull();
    expect(parseLag('1x')).toBeNull();
  });
});

describe('parseDependencyNotation', () => {
  it('parses a default-FS bare ref', () => {
    const { terms, errors } = parseDependencyNotation('2');
    expect(errors).toEqual([]);
    expect(terms).toEqual([{ ref: 2, rawRef: '2', type: 'FS', lag: 0 }]);
  });

  it('parses a multi-term string with types and lags', () => {
    const { terms, errors } = parseDependencyNotation('2FS+1d, 3SS, 5FF-2d');
    expect(errors).toEqual([]);
    expect(terms).toEqual([
      { ref: 2, rawRef: '2', type: 'FS', lag: DAY },
      { ref: 3, rawRef: '3', type: 'SS', lag: 0 },
      { ref: 5, rawRef: '5', type: 'FF', lag: -2 * DAY },
    ]);
  });

  it('accepts semicolons as separators and is case-insensitive on type', () => {
    const { terms } = parseDependencyNotation('2fs+1d; 3ss');
    expect(terms.map((t) => t.type)).toEqual(['FS', 'SS']);
  });

  it('coerces numeric tokens to numbers but keeps string ids', () => {
    const numeric = parseDependencyNotation('10');
    expect(numeric.terms[0]!.ref).toBe(10);
    const str = parseDependencyNotation('task-a');
    expect(str.terms[0]!.ref).toBe('task-a');
  });

  it('resolves refs through resolveRef and rejects unknown tokens', () => {
    const map: Record<string, string> = { '1.2': 't5' };
    const { terms, errors } = parseDependencyNotation('1.2SS+1d, 9.9', {
      resolveRef: (tok) => map[tok],
    });
    expect(terms).toEqual([{ ref: 't5', rawRef: '1.2', type: 'SS', lag: DAY }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.reason).toBe('unknownRef');
  });

  it('rejects self-references and duplicates', () => {
    const self = parseDependencyNotation('5', { selfId: 5 });
    expect(self.terms).toEqual([]);
    expect(self.errors[0]!.reason).toBe('selfRef');

    const dup = parseDependencyNotation('2FS, 2FS');
    expect(dup.terms).toHaveLength(1);
    expect(dup.errors[0]!.reason).toBe('duplicate');
  });

  it('reports an unknown type without dropping the rest', () => {
    // "2XY" -> the "XY" is not a known type, and it is not a valid trailing lag,
    // so the whole term is treated as a string ref token. With a resolveRef that
    // only knows numeric ids, that token is rejected as unknown; term "3" lives.
    const { terms, errors } = parseDependencyNotation('2XY, 3', {
      resolveRef: (tok) => (/^\d+$/.test(tok) ? Number(tok) : undefined),
    });
    expect(terms.some((t) => t.ref === 3)).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.reason).toBe('unknownRef');
  });

  it('ignores empty terms from trailing separators', () => {
    const { terms, errors } = parseDependencyNotation('2, , 3,');
    expect(terms.map((t) => t.ref)).toEqual([2, 3]);
    expect(errors).toEqual([]);
  });
});

describe('serialize', () => {
  it('round-trips notation (omitting FS + zero lag)', () => {
    expect(serializeDependencyTerm({ ref: 2, type: 'FS', lag: 0 })).toBe('2');
    expect(serializeDependencyTerm({ ref: 3, type: 'SS', lag: DAY })).toBe('3SS+1d');
    expect(serializeDependencyTerm({ ref: 5, type: 'FF', lag: -2 * DAY })).toBe('5FF-2d');
  });

  it('joins multiple terms', () => {
    const s = serializeDependencyTerms([
      { ref: 2, type: 'FS', lag: 0 },
      { ref: 3, type: 'SS', lag: DAY },
    ]);
    expect(s).toBe('2, 3SS+1d');
  });

  it('formats sub-day lag as hours when hoursPerDay is 24', () => {
    expect(formatLag(2 * HOUR)).toBe('+2h');
    expect(formatLag(0)).toBe('');
  });

  it('re-parses what it serialized', () => {
    const terms = [
      { ref: 2, type: 'FS' as const, lag: 0 },
      { ref: 3, type: 'SS' as const, lag: DAY },
      { ref: 5, type: 'FF' as const, lag: -2 * DAY },
    ];
    const text = serializeDependencyTerms(terms);
    const back = parseDependencyNotation(text);
    expect(back.errors).toEqual([]);
    expect(back.terms.map((t) => ({ ref: t.ref, type: t.type, lag: t.lag }))).toEqual(terms);
  });
});

describe('diffDependencyTerms', () => {
  it('adds new, removes dropped, and replaces lag-changed links', () => {
    const existing = [
      { id: 'l1', ref: 2 as const, type: 'FS' as const, lag: 0 },
      { id: 'l2', ref: 3 as const, type: 'SS' as const, lag: DAY },
      { id: 'l3', ref: 9 as const, type: 'FS' as const, lag: 0 },
    ];
    const desired = parseDependencyNotation('2, 3SS+2d, 5').terms; // keep 2, change l2 lag, add 5, drop 9
    const { toAdd, toRemove } = diffDependencyTerms(desired, existing);

    // l1 (2/FS/0) unchanged -> not added, not removed.
    expect(toAdd.find((t) => t.ref === 2)).toBeUndefined();
    expect(toRemove).toContain('l3'); // 9 dropped
    expect(toRemove).toContain('l2'); // lag changed -> replace
    expect(toAdd.some((t) => t.ref === 3 && t.lag === 2 * DAY)).toBe(true);
    expect(toAdd.some((t) => t.ref === 5)).toBe(true);
  });

  it('is a no-op when desired equals existing', () => {
    const existing = [{ id: 'l1', ref: 2 as const, type: 'FS' as const, lag: 0 }];
    const desired = parseDependencyNotation('2').terms;
    const { toAdd, toRemove } = diffDependencyTerms(desired, existing);
    expect(toAdd).toEqual([]);
    expect(toRemove).toEqual([]);
  });
});
