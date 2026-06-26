/** jsdom unit test for clipboard block (de)serialization. */
import { describe, it, expect } from 'vitest';
import { blockToTsv, parsePastedText, inferPasted } from './clipboard.js';

describe('clipboard', () => {
  it('serializes a value block to TSV', () => {
    expect(
      blockToTsv([
        ['a', 1],
        ['b', 2],
      ]),
    ).toBe('a\t1\nb\t2');
  });

  it('sanitizes tabs/newlines inside fields', () => {
    expect(blockToTsv([['a\tb\nc']])).toBe('a b c');
  });

  it('parses pasted TSV into a grid', () => {
    expect(parsePastedText('a\t1\nb\t2')).toEqual([
      ['a', '1'],
      ['b', '2'],
    ]);
  });

  it('falls back to CSV when no tabs present', () => {
    expect(parsePastedText('a,1\nb,2')).toEqual([
      ['a', '1'],
      ['b', '2'],
    ]);
  });

  it('drops a single trailing newline', () => {
    expect(parsePastedText('a\tb\n')).toEqual([['a', 'b']]);
  });

  it('defends against TSV formula injection', () => {
    // Leading =/+/-/@ are neutralised with a leading apostrophe by default.
    expect(blockToTsv([['=1+1', '+2', '-3', '@x']])).toBe("'=1+1\t'+2\t'-3\t'@x");
    // Opt-out leaves the raw text.
    expect(blockToTsv([['=1+1']], { sanitizeInjection: false })).toBe('=1+1');
    // Safe fields are untouched.
    expect(blockToTsv([['ok', 5]])).toBe('ok\t5');
  });

  it('infers typed values', () => {
    expect(inferPasted('42')).toBe(42);
    expect(inferPasted('true')).toBe(true);
    expect(inferPasted('hi')).toBe('hi');
    expect(inferPasted('')).toBe(null);
  });
});
