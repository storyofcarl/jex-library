/**
 * AST evaluator. Walks an `Ast` against an `EvalContext`, producing a
 * `CellValue` (or a 2D array for dynamic-array results). Refs/ranges are
 * resolved through the context; operators implement Excel coercion + error
 * propagation; function calls dispatch to the registered library.
 *
 * The evaluator also records the set of precedent refs it touched (so the
 * engine can build dependency edges) via an optional `RefCollector`.
 */

import type {
  Ast,
  AstNode,
  CellRef,
  CellValue,
  EvalContext,
  SpreadsheetFunction,
} from '../contract.js';
import { normalizeBox, parseA1 } from './a1.js';
import { ERR, isError, makeError, toBoolean, toNumber, toText } from './errors.js';
import { type FnArg, asScalar, compareValues, isMatrix, looseEquals } from './helpers.js';

/** Collects the refs/ranges an evaluation depended on (for the dep graph). */
export interface RefCollector {
  addRef(ref: CellRef): void;
  addRange(from: CellRef, to: CellRef): void;
}

export interface EvaluatorDeps {
  /** Look up a function by (case-insensitive) name. */
  getFunction(name: string): SpreadsheetFunction | undefined;
  /** Resolve a named range to its A1/range string, if defined. */
  resolveName(name: string): string | undefined;
}

export class Evaluator {
  constructor(private readonly deps: EvaluatorDeps) {}

  /** Evaluate an AST root to a value or array. */
  evalNode(node: AstNode | undefined, ctx: EvalContext, collector?: RefCollector): FnArg {
    if (node === undefined) return '';
    switch (node.kind) {
      case 'literal':
        return node.value;
      case 'error':
        return makeError(node.code);
      case 'ref':
        return this.evalRef(node.a1, ctx, collector);
      case 'range':
        return this.evalRange(node.from, node.to, ctx, collector);
      case 'name':
        return this.evalName(node.name, ctx, collector);
      case 'unary':
        return this.evalUnary(node, ctx, collector);
      case 'binary':
        return this.evalBinary(node, ctx, collector);
      case 'call':
        return this.evalCall(node, ctx, collector);
      default:
        return ERR.VALUE;
    }
  }

  /** Top-level: evaluate to a single scalar (arrays reduced to top-left). */
  evalToValue(ast: Ast, ctx: EvalContext, collector?: RefCollector): CellValue {
    const r = this.evalNode(ast.root, ctx, collector);
    return isMatrix(r) ? r[0]?.[0] ?? null : r;
  }

  /** Evaluate possibly to an array (for spill). */
  evalToArrayOrValue(ast: Ast, ctx: EvalContext, collector?: RefCollector): FnArg {
    return this.evalNode(ast.root, ctx, collector);
  }

  private resolveRef(a1: string, ctx: EvalContext): CellRef | undefined {
    const parsed = parseA1(a1);
    let sheet = ctx.origin.sheet;
    if (parsed.sheet) {
      const id = ctx.resolveSheet(parsed.sheet);
      if (!id) return undefined;
      sheet = id;
    }
    return { sheet, row: parsed.row, col: parsed.col };
  }

  private evalRef(a1: string, ctx: EvalContext, collector?: RefCollector): CellValue {
    const ref = this.resolveRef(a1, ctx);
    if (!ref) return ERR.REF;
    collector?.addRef(ref);
    const v = ctx.getValue(ref);
    return v ?? null;
  }

  private evalRange(
    fromA1: string,
    toA1: string,
    ctx: EvalContext,
    collector?: RefCollector,
  ): CellValue[][] | CellValue {
    const from = this.resolveRef(fromA1, ctx);
    const to = this.resolveRef(toA1, ctx);
    if (!from || !to) return ERR.REF;
    collector?.addRange(from, to);
    return ctx.getRange(from, to);
  }

  private evalName(name: string, ctx: EvalContext, collector?: RefCollector): FnArg {
    const def = this.deps.resolveName(name);
    if (def === undefined) return ERR.NAME;
    // Named range may be a single ref or a range.
    if (def.includes(':')) {
      const [a, b] = def.split(':');
      return this.evalRange(a as string, b as string, ctx, collector);
    }
    return this.evalRef(def, ctx, collector);
  }

  private evalUnary(
    node: Extract<AstNode, { kind: 'unary' }>,
    ctx: EvalContext,
    collector?: RefCollector,
  ): CellValue {
    const operand = asScalar(this.evalNode(node.operand, ctx, collector));
    if (isError(operand)) return operand;
    if (node.op === '%') {
      const n = toNumber(operand);
      if (isError(n)) return n;
      return (n as number) / 100;
    }
    const n = toNumber(operand);
    if (isError(n)) return n;
    return node.op === '-' ? -(n as number) : (n as number);
  }

  private evalBinary(
    node: Extract<AstNode, { kind: 'binary' }>,
    ctx: EvalContext,
    collector?: RefCollector,
  ): CellValue {
    const left = asScalar(this.evalNode(node.left, ctx, collector));
    const right = asScalar(this.evalNode(node.right, ctx, collector));
    if (isError(left)) return left;
    if (isError(right)) return right;

    switch (node.op) {
      case '&':
        return toText(left) + toText(right);
      case '=':
        return looseEquals(left, right);
      case '<>':
        return !looseEquals(left, right);
      case '<':
        return compareValues(left, right) < 0;
      case '<=':
        return compareValues(left, right) <= 0;
      case '>':
        return compareValues(left, right) > 0;
      case '>=':
        return compareValues(left, right) >= 0;
      default:
        break;
    }
    // Arithmetic.
    const a = toNumber(left);
    if (isError(a)) return a;
    const b = toNumber(right);
    if (isError(b)) return b;
    const x = a as number;
    const y = b as number;
    switch (node.op) {
      case '+':
        return x + y;
      case '-':
        return x - y;
      case '*':
        return x * y;
      case '/':
        return y === 0 ? ERR.DIV0 : x / y;
      case '^': {
        const r = Math.pow(x, y);
        return Number.isNaN(r) ? ERR.NUM : r;
      }
      default:
        return ERR.VALUE;
    }
  }

  private evalCall(
    node: Extract<AstNode, { kind: 'call' }>,
    ctx: EvalContext,
    collector?: RefCollector,
  ): FnArg {
    const fn = this.deps.getFunction(node.name);
    if (!fn) return makeError('#NAME?', node.name);
    // Lazy functions (IF/IFERROR/AND/OR short-circuit) — but for simplicity and
    // correctness with error propagation we eagerly evaluate args, except we
    // special-case the short-circuit logicals so errors in the untaken branch
    // don't surface.
    const upper = node.name.toUpperCase();
    if (upper === 'IF') {
      return this.evalIf(node.args, ctx, collector);
    }
    if (upper === 'IFERROR' || upper === 'IFNA') {
      return this.evalIfError(upper, node.args, ctx, collector);
    }
    const args: FnArg[] = node.args.map((a) => this.evalNode(a, ctx, collector));
    return fn(args, ctx);
  }

  private evalIf(args: AstNode[], ctx: EvalContext, collector?: RefCollector): FnArg {
    const cond = toBoolean(asScalar(this.evalNode(args[0], ctx, collector)));
    if (isError(cond)) return cond;
    if (cond) {
      return args.length > 1 ? this.evalNode(args[1], ctx, collector) : true;
    }
    return args.length > 2 ? this.evalNode(args[2], ctx, collector) : false;
  }

  private evalIfError(
    which: string,
    args: AstNode[],
    ctx: EvalContext,
    collector?: RefCollector,
  ): FnArg {
    const v = this.evalNode(args[0], ctx, collector);
    const scalar = asScalar(v);
    const isMatch =
      which === 'IFNA' ? isError(scalar) && scalar.code === '#N/A' : isError(scalar);
    if (isMatch) {
      return args.length > 1 ? this.evalNode(args[1], ctx, collector) : ERR.NA;
    }
    return v;
  }
}

export { normalizeBox };
