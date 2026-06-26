/**
 * Formula tokenizer (lexer). Turns a formula source string (without the leading
 * `=`) into a flat token stream the parser consumes. Recognizes numbers,
 * strings, booleans, errors, A1/range references (incl. sheet qualifiers),
 * named identifiers, function names, operators, and structural punctuation.
 */

export type TokenType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'error'
  | 'ref' // a single A1 ref, possibly sheet-qualified, possibly $-anchored
  | 'name' // identifier / named range / function name (followed by `(`)
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'lbrace'
  | 'rbrace'
  | 'comma'
  | 'colon'
  | 'semicolon'
  | 'percent'
  | 'eof';

export interface Token {
  type: TokenType;
  /** Raw source text of the token. */
  text: string;
  /** Parsed value for literals (number / boolean). */
  value?: number | boolean;
  /** Start offset in the source (for diagnostics). */
  pos: number;
}

export class TokenizeError extends Error {
  constructor(
    message: string,
    public pos: number,
  ) {
    super(message);
    this.name = 'TokenizeError';
  }
}

const ERROR_LITERALS = [
  '#NULL!',
  '#DIV/0!',
  '#VALUE!',
  '#REF!',
  '#NAME?',
  '#NUM!',
  '#N/A',
  '#SPILL!',
  '#CYCLE!',
  '#CALC!',
];

const OPERATORS = ['<=', '>=', '<>', '+', '-', '*', '/', '^', '&', '=', '<', '>'];

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}
function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z'));
}
function isIdentStart(ch: string | undefined): boolean {
  return isLetter(ch) || ch === '_';
}
function isIdentPart(ch: string | undefined): boolean {
  return isLetter(ch) || isDigit(ch) || ch === '_' || ch === '.';
}

export function tokenize(input: string): Token[] {
  const src = input;
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i] as string;

    // Whitespace.
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    const start = i;

    // String literal "..." with "" escaping.
    if (ch === '"') {
      i++;
      let str = '';
      while (i < n) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            str += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        str += src[i] as string;
        i++;
      }
      tokens.push({ type: 'string', text: str, pos: start });
      continue;
    }

    // Error literal (#...).
    if (ch === '#') {
      let matched: string | undefined;
      for (const lit of ERROR_LITERALS) {
        if (src.startsWith(lit, i)) {
          matched = lit;
          break;
        }
      }
      if (matched) {
        i += matched.length;
        tokens.push({ type: 'error', text: matched, pos: start });
        continue;
      }
      throw new TokenizeError(`Unexpected '#' at ${i}`, i);
    }

    // Number: 123, 12.5, .5, 1e3, 1.2E-3.
    if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1] ?? ''))) {
      let j = i;
      while (j < n && isDigit(src[j])) j++;
      if (src[j] === '.') {
        j++;
        while (j < n && isDigit(src[j])) j++;
      }
      if (src[j] === 'e' || src[j] === 'E') {
        let k = j + 1;
        if (src[k] === '+' || src[k] === '-') k++;
        if (isDigit(src[k] ?? '')) {
          k++;
          while (k < n && isDigit(src[k])) k++;
          j = k;
        }
      }
      const text = src.slice(i, j);
      tokens.push({ type: 'number', text, value: Number(text), pos: start });
      i = j;
      continue;
    }

    // Quoted sheet name 'My Sheet'!A1 — consume the quoted part then the ref.
    if (ch === "'") {
      const ref = readQuotedSheetRef(src, i);
      if (ref) {
        tokens.push({ type: 'ref', text: ref.text, pos: start });
        i = ref.end;
        continue;
      }
      throw new TokenizeError(`Unterminated sheet name at ${i}`, i);
    }

    // Identifier / reference / function name / boolean.
    if (isIdentStart(ch) || ch === '$') {
      const read = readRefOrName(src, i);
      i = read.end;
      const text = read.text;
      const upper = text.toUpperCase();
      // TRUE/FALSE are boolean literals unless written as calls TRUE()/FALSE().
      const followedByParen = src[i] === '(';
      if (read.isRef) {
        tokens.push({ type: 'ref', text, pos: start });
      } else if (upper === 'TRUE' && !followedByParen) {
        tokens.push({ type: 'boolean', text, value: true, pos: start });
      } else if (upper === 'FALSE' && !followedByParen) {
        tokens.push({ type: 'boolean', text, value: false, pos: start });
      } else {
        tokens.push({ type: 'name', text, pos: start });
      }
      continue;
    }

    // Structural / operators.
    switch (ch) {
      case '(':
        tokens.push({ type: 'lparen', text: ch, pos: start });
        i++;
        continue;
      case ')':
        tokens.push({ type: 'rparen', text: ch, pos: start });
        i++;
        continue;
      case '{':
        tokens.push({ type: 'lbrace', text: ch, pos: start });
        i++;
        continue;
      case '}':
        tokens.push({ type: 'rbrace', text: ch, pos: start });
        i++;
        continue;
      case ',':
        tokens.push({ type: 'comma', text: ch, pos: start });
        i++;
        continue;
      case ':':
        tokens.push({ type: 'colon', text: ch, pos: start });
        i++;
        continue;
      case ';':
        tokens.push({ type: 'semicolon', text: ch, pos: start });
        i++;
        continue;
      case '%':
        tokens.push({ type: 'percent', text: ch, pos: start });
        i++;
        continue;
      default:
        break;
    }

    let opMatched: string | undefined;
    for (const op of OPERATORS) {
      if (src.startsWith(op, i)) {
        opMatched = op;
        break;
      }
    }
    if (opMatched) {
      tokens.push({ type: 'op', text: opMatched, pos: start });
      i += opMatched.length;
      continue;
    }

    throw new TokenizeError(`Unexpected character '${ch}' at ${i}`, i);
  }

  tokens.push({ type: 'eof', text: '', pos: n });
  return tokens;
}

/** Reads a `'Sheet Name'!A1` reference starting at a quote. */
function readQuotedSheetRef(
  src: string,
  start: number,
): { text: string; end: number } | undefined {
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === "'") {
      if (src[i + 1] === "'") {
        i += 2;
        continue;
      }
      i++;
      break;
    }
    i++;
  }
  if (src[i] !== '!') return undefined;
  i++;
  // Now read the cell part: $?COL$?ROW.
  const cell = readA1Cell(src, i);
  if (!cell) return undefined;
  return { text: src.slice(start, cell.end), end: cell.end };
}

/** Try to read the `$?COL$?ROW` core of an A1 reference. */
function readA1Cell(src: string, start: number): { end: number } | undefined {
  let i = start;
  if (src[i] === '$') i++;
  let colLen = 0;
  while (i < src.length && isLetter(src[i])) {
    i++;
    colLen++;
  }
  if (colLen === 0) return undefined;
  if (src[i] === '$') i++;
  let rowLen = 0;
  while (i < src.length && isDigit(src[i])) {
    i++;
    rowLen++;
  }
  if (rowLen === 0) return undefined;
  return { end: i };
}

/**
 * Read a bare identifier OR an unquoted-sheet ref OR a plain A1 ref starting at
 * an ident-start or `$`. Decides whether it is a reference (A1) or a name.
 */
function readRefOrName(
  src: string,
  start: number,
): { text: string; end: number; isRef: boolean } {
  // First, try to read a leading identifier segment (could be a sheet name or
  // a column label or a function/name token).
  const i = start;

  // Case: starts with `$` → must be a ref like $A$1 or $A1.
  if (src[i] === '$') {
    const cell = readA1Cell(src, i);
    if (cell) return { text: src.slice(start, cell.end), end: cell.end, isRef: true };
  }

  // Read the first ident run.
  let j = i;
  while (j < src.length && isIdentPart(src[j])) j++;
  const first = src.slice(i, j);

  // Sheet-qualified ref: Name!...
  if (src[j] === '!') {
    const cellStart = j + 1;
    const cell = readA1Cell(src, cellStart);
    if (cell) {
      return { text: src.slice(start, cell.end), end: cell.end, isRef: true };
    }
    // `Name!` with no valid cell — treat the ident as a name (rare/malformed).
    return { text: first, end: j, isRef: false };
  }

  // Plain ref? The ident must look like COL+ROW (e.g. AB12) and nothing after.
  if (looksLikeA1(first)) {
    return { text: first, end: j, isRef: true };
  }

  // Otherwise an identifier / function name / named range.
  return { text: first, end: j, isRef: false };
}

/** Does a bare identifier read as an A1 cell (letters then digits, no dots)? */
function looksLikeA1(s: string): boolean {
  return /^[A-Za-z]{1,3}\d+$/.test(s);
}
