/**
 * Recursive-descent / precedence-climbing (Pratt) parser. Consumes the token
 * stream from the tokenizer and produces the `Ast` defined by the contract.
 *
 * Grammar (precedence low → high):
 *   expr      := compare
 *   compare   := concat ( (= <> < <= > >=) concat )*
 *   concat    := add ( & add )*
 *   add       := mul ( (+ -) mul )*
 *   mul       := unary ( (* /) unary )*
 *   unary     := (+ -) unary | power
 *   power     := postfix ( ^ unary )*      (right-assoc; ^ binds tighter than unary minus)
 *   postfix   := primary (%)*              (percent)
 *   primary   := number | string | bool | error | array
 *              | ref [ : ref ]             (range)
 *              | name ( '(' args ')' )?    (call or named ref)
 *              | '(' expr ')'
 *   array     := '{' row (';' row)* '}'    row := expr (, expr)*
 */

import type { Ast, AstNode, CellErrorCode } from '../contract.js';
import { errorCodeFromString } from './errors.js';
import { tokenize, type Token } from './tokenizer.js';

export class ParseError extends Error {
  constructor(
    message: string,
    public pos: number,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

class Parser {
  private i = 0;
  constructor(private readonly toks: Token[]) {}

  private peek(): Token {
    return this.toks[this.i] as Token;
  }
  private next(): Token {
    return this.toks[this.i++] as Token;
  }
  private expect(type: Token['type']): Token {
    const t = this.peek();
    if (t.type !== type) {
      throw new ParseError(`Expected ${type} but got '${t.text || t.type}'`, t.pos);
    }
    return this.next();
  }

  parse(): AstNode {
    const node = this.parseExpr();
    const t = this.peek();
    if (t.type !== 'eof') {
      throw new ParseError(`Unexpected '${t.text || t.type}'`, t.pos);
    }
    return node;
  }

  private parseExpr(): AstNode {
    return this.parseCompare();
  }

  private parseCompare(): AstNode {
    let left = this.parseConcat();
    while (this.peek().type === 'op' && isCompareOp(this.peek().text)) {
      const op = this.next().text as '=' | '<>' | '<' | '<=' | '>' | '>=';
      const right = this.parseConcat();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseConcat(): AstNode {
    let left = this.parseAdd();
    while (this.peek().type === 'op' && this.peek().text === '&') {
      this.next();
      const right = this.parseAdd();
      left = { kind: 'binary', op: '&', left, right };
    }
    return left;
  }

  private parseAdd(): AstNode {
    let left = this.parseMul();
    while (this.peek().type === 'op' && (this.peek().text === '+' || this.peek().text === '-')) {
      const op = this.next().text as '+' | '-';
      const right = this.parseMul();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseMul(): AstNode {
    let left = this.parseUnary();
    while (this.peek().type === 'op' && (this.peek().text === '*' || this.peek().text === '/')) {
      const op = this.next().text as '*' | '/';
      const right = this.parseUnary();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseUnary(): AstNode {
    const t = this.peek();
    if (t.type === 'op' && (t.text === '+' || t.text === '-')) {
      this.next();
      // Unary +/- binds LOOSER than `^` (Excel/Sheets rule): `-2^2` => -(2^2).
      const operand = this.parseUnary();
      return { kind: 'unary', op: t.text as '+' | '-', operand };
    }
    return this.parsePower();
  }

  private parsePower(): AstNode {
    // The power base must not consume a preceding sign (handled by parseUnary),
    // so `-2^2` parses as unary(-, power(2,2)).
    const left = this.parsePostfix();
    if (this.peek().type === 'op' && this.peek().text === '^') {
      this.next();
      // Right-associative; allow a signed exponent (`2^-3`).
      const right = this.parseUnary();
      return { kind: 'binary', op: '^', left, right };
    }
    return left;
  }

  private parsePostfix(): AstNode {
    let node = this.parsePrimary();
    while (this.peek().type === 'percent') {
      this.next();
      node = { kind: 'unary', op: '%', operand: node };
    }
    return node;
  }

  private parsePrimary(): AstNode {
    const t = this.peek();
    switch (t.type) {
      case 'number':
        this.next();
        return { kind: 'literal', value: t.value as number };
      case 'string':
        this.next();
        return { kind: 'literal', value: t.text };
      case 'boolean':
        this.next();
        return { kind: 'literal', value: t.value as boolean };
      case 'error': {
        this.next();
        const code = errorCodeFromString(t.text) as CellErrorCode;
        return { kind: 'error', code };
      }
      case 'lparen': {
        this.next();
        const inner = this.parseExpr();
        this.expect('rparen');
        return inner;
      }
      case 'lbrace':
        return this.parseArray();
      case 'ref':
        return this.parseRefMaybeRange();
      case 'name':
        return this.parseNameOrCall();
      default:
        throw new ParseError(`Unexpected '${t.text || t.type}'`, t.pos);
    }
  }

  private parseRefMaybeRange(): AstNode {
    const from = this.next().text;
    if (this.peek().type === 'colon') {
      this.next();
      const toTok = this.peek();
      if (toTok.type !== 'ref') {
        throw new ParseError(`Expected reference after ':'`, toTok.pos);
      }
      this.next();
      return { kind: 'range', from, to: toTok.text };
    }
    return { kind: 'ref', a1: from };
  }

  private parseNameOrCall(): AstNode {
    const nameTok = this.next();
    if (this.peek().type === 'lparen') {
      this.next();
      const args = this.parseArgs();
      this.expect('rparen');
      return { kind: 'call', name: nameTok.text, args };
    }
    // A bare name: could also be a named-range:reference range (Name1:Name2)
    // but the common case is a named range / defined name.
    return { kind: 'name', name: nameTok.text };
  }

  private parseArgs(): AstNode[] {
    const args: AstNode[] = [];
    if (this.peek().type === 'rparen') return args;
    // Allow a leading empty argument (e.g. `FN(,2)`).
    args.push(this.parseArgOrEmpty());
    while (this.peek().type === 'comma' || this.peek().type === 'semicolon') {
      this.next();
      args.push(this.parseArgOrEmpty());
    }
    return args;
  }

  private parseArgOrEmpty(): AstNode {
    const t = this.peek();
    if (t.type === 'comma' || t.type === 'semicolon' || t.type === 'rparen') {
      // Omitted argument → represent as an empty literal string sentinel that
      // functions treat as blank.
      return { kind: 'literal', value: '' };
    }
    return this.parseExpr();
  }

  private parseArray(): AstNode {
    // `{1,2;3,4}` → nested call to a virtual ARRAY constructor we lower into a
    // call node named "_ARRAY" with rows flattened and a row-length marker.
    this.expect('lbrace');
    const rows: AstNode[][] = [];
    let current: AstNode[] = [];
    rows.push(current);
    if (this.peek().type !== 'rbrace') {
      current.push(this.parseExpr());
      while (this.peek().type === 'comma' || this.peek().type === 'semicolon') {
        const sep = this.next();
        if (sep.type === 'semicolon') {
          current = [];
          rows.push(current);
        }
        current.push(this.parseExpr());
      }
    }
    this.expect('rbrace');
    // Lower to `_ARRAY(ncols, ...flat)` so the evaluator can rebuild the matrix.
    const ncols = rows[0]?.length ?? 0;
    const flat: AstNode[] = [{ kind: 'literal', value: ncols }];
    for (const row of rows) {
      for (const cell of row) flat.push(cell);
    }
    return { kind: 'call', name: '_ARRAY', args: flat };
  }
}

function isCompareOp(text: string): boolean {
  return text === '=' || text === '<>' || text === '<' || text === '<=' || text === '>' || text === '>=';
}

/**
 * Parse a formula source (with or without a leading `=`) into an `Ast`. On a
 * syntax error, returns an `Ast` whose root is an `error`-kind node (`#NAME?`
 * for unknown structure, `#VALUE!`/`#REF!` where appropriate); never throws so
 * the evaluator can surface the error as a cell value.
 */
export function parseFormula(formula: string): Ast {
  const source = formula.startsWith('=') ? formula.slice(1) : formula;
  if (source.trim() === '') {
    return { root: { kind: 'literal', value: '' }, source };
  }
  try {
    const toks = tokenize(source);
    const parser = new Parser(toks);
    const root = parser.parse();
    return { root, source };
  } catch {
    return { root: { kind: 'error', code: '#NAME?' }, source };
  }
}

/** Strict variant used by tests: throws `ParseError` on malformed input. */
export function parseFormulaStrict(formula: string): Ast {
  const source = formula.startsWith('=') ? formula.slice(1) : formula;
  const toks = tokenize(source);
  const parser = new Parser(toks);
  const root = parser.parse();
  return { root, source };
}
