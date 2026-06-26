import { describe, expect, it } from 'vitest';
import { parseFormula, parseFormulaStrict, ParseError } from './parser.js';
import { tokenize } from './tokenizer.js';
import type { AstNode } from '../contract.js';

describe('tokenizer', () => {
  it('tokenizes numbers, strings, operators', () => {
    const toks = tokenize('1+2.5*"hi"');
    expect(toks.map((t) => t.type)).toEqual([
      'number',
      'op',
      'number',
      'op',
      'string',
      'eof',
    ]);
    expect(toks[0].value).toBe(1);
    expect(toks[2].value).toBe(2.5);
    expect(toks[4].text).toBe('hi');
  });

  it('handles escaped quotes in strings', () => {
    const toks = tokenize('"a""b"');
    expect(toks[0].text).toBe('a"b');
  });

  it('recognizes A1 refs and ranges', () => {
    const toks = tokenize('A1:B2');
    expect(toks.map((t) => t.type)).toEqual(['ref', 'colon', 'ref', 'eof']);
  });

  it('recognizes sheet-qualified refs', () => {
    const toks = tokenize('Sheet2!A1');
    expect(toks[0].type).toBe('ref');
    expect(toks[0].text).toBe('Sheet2!A1');
  });

  it('recognizes quoted-sheet refs', () => {
    const toks = tokenize("'My Sheet'!A1");
    expect(toks[0].type).toBe('ref');
    expect(toks[0].text).toBe("'My Sheet'!A1");
  });

  it('recognizes booleans and errors', () => {
    expect(tokenize('TRUE')[0].type).toBe('boolean');
    expect(tokenize('#DIV/0!')[0].type).toBe('error');
  });

  it('recognizes absolute refs', () => {
    const toks = tokenize('$A$1');
    expect(toks[0].type).toBe('ref');
    expect(toks[0].text).toBe('$A$1');
  });
});

describe('parser precedence', () => {
  const root = (f: string): AstNode => parseFormulaStrict(f).root;

  it('multiplication binds tighter than addition', () => {
    const r = root('1+2*3');
    expect(r).toMatchObject({ kind: 'binary', op: '+' });
    if (r.kind === 'binary') {
      expect(r.right).toMatchObject({ kind: 'binary', op: '*' });
    }
  });

  it('power is right-associative', () => {
    const r = root('2^3^2');
    expect(r).toMatchObject({ kind: 'binary', op: '^' });
    if (r.kind === 'binary') {
      expect(r.right).toMatchObject({ kind: 'binary', op: '^' });
    }
  });

  it('unary minus', () => {
    expect(root('-5')).toMatchObject({ kind: 'unary', op: '-' });
  });

  it('power binds tighter than unary minus (-2^2 = -(2^2))', () => {
    const r = root('-2^2');
    expect(r).toMatchObject({ kind: 'unary', op: '-' });
    if (r.kind === 'unary') {
      expect(r.operand).toMatchObject({ kind: 'binary', op: '^' });
    }
  });

  it('allows a signed exponent (2^-3)', () => {
    const r = root('2^-3');
    expect(r).toMatchObject({ kind: 'binary', op: '^' });
    if (r.kind === 'binary') {
      expect(r.right).toMatchObject({ kind: 'unary', op: '-' });
    }
  });

  it('percent postfix', () => {
    expect(root('50%')).toMatchObject({ kind: 'unary', op: '%' });
  });

  it('comparison operators', () => {
    expect(root('A1<=B1')).toMatchObject({ kind: 'binary', op: '<=' });
    expect(root('A1<>B1')).toMatchObject({ kind: 'binary', op: '<>' });
  });

  it('concatenation', () => {
    expect(root('"a"&"b"')).toMatchObject({ kind: 'binary', op: '&' });
  });

  it('parentheses override precedence', () => {
    const r = root('(1+2)*3');
    expect(r).toMatchObject({ kind: 'binary', op: '*' });
  });
});

describe('parser refs / calls / arrays', () => {
  const root = (f: string): AstNode => parseFormulaStrict(f).root;

  it('parses a ref', () => {
    expect(root('A1')).toMatchObject({ kind: 'ref', a1: 'A1' });
  });

  it('parses a range', () => {
    expect(root('A1:B3')).toMatchObject({ kind: 'range', from: 'A1', to: 'B3' });
  });

  it('parses a function call', () => {
    const r = root('SUM(A1:A3, 5)');
    expect(r).toMatchObject({ kind: 'call', name: 'SUM' });
    if (r.kind === 'call') expect(r.args).toHaveLength(2);
  });

  it('parses nested calls', () => {
    const r = root('IF(A1>0, SUM(B1:B3), 0)');
    expect(r).toMatchObject({ kind: 'call', name: 'IF' });
  });

  it('parses array literals', () => {
    const r = root('{1,2;3,4}');
    expect(r).toMatchObject({ kind: 'call', name: '_ARRAY' });
  });

  it('parses a defined name', () => {
    expect(root('MyRange')).toMatchObject({ kind: 'name', name: 'MyRange' });
  });
});

describe('parseFormula error handling', () => {
  it('returns an error node for malformed input (no throw)', () => {
    const ast = parseFormula('1+');
    expect(ast.root.kind).toBe('error');
  });

  it('strips leading =', () => {
    expect(parseFormula('=1+1').source).toBe('1+1');
  });

  it('strict parser throws on malformed', () => {
    expect(() => parseFormulaStrict('SUM(')).toThrow(ParseError);
  });

  it('empty formula → empty literal', () => {
    expect(parseFormula('').root).toMatchObject({ kind: 'literal', value: '' });
  });
});
