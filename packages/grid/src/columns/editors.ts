/**
 * Typed cell editors — `CellEditor` implementations (per the frozen contract)
 * that reuse @jects/widgets controls via the @jects/core factory:
 *
 *   text   → TextField     (type 'textfield')
 *   number → NumberField   (type 'numberfield')
 *   date   → DatePicker    (type 'datepicker')
 *   check  → Checkbox      (type 'checkbox')
 *   select → Select        (type 'select')   (column.type 'text'+meta.options, or 'template')
 *
 * Editors are built lazily via `create({ type, ...config }, host)` so this module
 * never imports @jects/widgets classes directly — it stays decoupled and only
 * depends on the controls being registered at runtime (which importing
 * @jects/widgets guarantees). The factory returns a Widget; we drive it through
 * its imperative surface and read the value back via DOM on commit.
 *
 * The `EditController` orchestrates the edit LIFECYCLE around any `CellEditor`:
 * a vetoable `beforeStart`, mount/focus, validate-then-commit (vetoable), and
 * cancel — mirroring the engine's `EditSession`. It is the reusable mixin the
 * engine wires its keyboard/blur triggers into.
 */

import { create, type Widget, type Model } from '@jects/core';
import type {
  CellEditContext,
  CellEditor,
  ColumnDef,
  ColumnType,
} from '../contract.js';

/** A minimal structural view of a Widget that owns a DOM root + destroy(). */
interface WidgetLike {
  readonly el: HTMLElement;
  destroy(): void;
  on(event: string, fn: (payload: unknown) => unknown): () => void;
  getConfig?(): Record<string, unknown>;
}

/** Read the current value out of a mounted control's DOM (jsdom-safe). */
function readControlValue(type: ControlType, el: HTMLElement): unknown {
  switch (type) {
    case 'checkbox': {
      const input = el.querySelector<HTMLInputElement>('input[type="checkbox"]');
      return input ? input.checked : false;
    }
    case 'datepicker': {
      const input = el.querySelector<HTMLInputElement>('input');
      const raw = input?.value ?? '';
      if (!raw) return null;
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? raw : d;
    }
    case 'numberfield': {
      const input = el.querySelector<HTMLInputElement>('input');
      const raw = input?.value ?? '';
      if (raw === '') return null;
      const n = Number(raw);
      return Number.isNaN(n) ? raw : n;
    }
    case 'select': {
      // Select renders a trigger; the chosen value lives on a data attr we set
      // from change events, falling back to the trigger's text.
      const stored = el.getAttribute('data-jects-edit-value');
      return stored ?? '';
    }
    default: {
      const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
      return input?.value ?? '';
    }
  }
}

/** Move focus into the first focusable input of a control. */
function focusControl(el: HTMLElement): void {
  const focusable = el.querySelector<HTMLElement>('input, textarea, button, [tabindex]');
  focusable?.focus();
  if (focusable instanceof HTMLInputElement && focusable.type !== 'checkbox') {
    try {
      focusable.select();
    } catch {
      /* select() may be unavailable for some input types */
    }
  }
}

/** The registered factory `type` strings for the controls we wrap. */
export type ControlType = 'textfield' | 'numberfield' | 'datepicker' | 'checkbox' | 'select';

/** Per-column editor options (read from `column.meta.editor`). */
export interface EditorMeta {
  /** Force a specific control type. Overrides the type→control mapping. */
  control?: ControlType;
  /** Options for a `select` control. */
  options?: { value: string; label: string }[];
  /** Extra config merged into the control's construction config. */
  config?: Record<string, unknown>;
}

/** Map a column `ColumnType` to the control we instantiate. */
export function controlForColumn<Row extends Model>(column: ColumnDef<Row>): ControlType {
  const meta = (column.meta as { editor?: EditorMeta } | undefined)?.editor;
  if (meta?.control) return meta.control;
  if (meta?.options) return 'select';
  const type: ColumnType = column.type ?? 'text';
  switch (type) {
    case 'number':
      return 'numberfield';
    case 'date':
      return 'datepicker';
    case 'check':
      return 'checkbox';
    default:
      return 'textfield';
  }
}

/** Build the construction config for a control given the edit context. */
function buildControlConfig(
  control: ControlType,
  ctx: CellEditContext<Model>,
): Record<string, unknown> {
  const meta = (ctx.column.meta as { editor?: EditorMeta } | undefined)?.editor;
  const base: Record<string, unknown> = { ...(meta?.config ?? {}) };
  switch (control) {
    case 'checkbox':
      base.checked = ctx.value === true || ctx.value === 'true' || ctx.value === 1;
      break;
    case 'datepicker':
      base.value = ctx.value instanceof Date ? ctx.value : ctx.value ? new Date(String(ctx.value)) : null;
      break;
    case 'numberfield':
      base.value = ctx.value == null ? '' : String(ctx.value);
      break;
    case 'select':
      base.options = meta?.options ?? [];
      base.value = ctx.value == null ? '' : String(ctx.value);
      break;
    default:
      base.value = ctx.value == null ? '' : String(ctx.value);
      break;
  }
  return base;
}

/**
 * A `CellEditor` that wraps an @jects/widgets control built via the factory.
 * Construct it with the desired control type (or let the engine derive one from
 * the column). It satisfies the frozen `CellEditor` interface exactly.
 */
export class WidgetCellEditor<Row extends Model = Model> implements CellEditor<Row> {
  private widget: WidgetLike | null = null;
  private control: ControlType;
  private off: Array<() => void> = [];
  /** Optional per-column validator from `column.meta.editor.validate`. */
  private validator?: (value: unknown) => true | string;

  constructor(control?: ControlType) {
    this.control = control ?? 'textfield';
  }

  mount(ctx: CellEditContext<Row>): void {
    this.control = this.control ?? controlForColumn(ctx.column);
    // If no control was forced at construction, derive from the column now.
    if (!this.control) this.control = controlForColumn(ctx.column);
    const resolved = this.control || controlForColumn(ctx.column);
    this.control = resolved;

    const meta = (ctx.column.meta as { editor?: { validate?: (v: unknown) => true | string } } | undefined)
      ?.editor;
    if (meta?.validate) this.validator = meta.validate;

    const config = buildControlConfig(resolved, ctx as unknown as CellEditContext<Model>);
    const widget = create({ type: resolved, ...config }) as unknown as WidgetLike;
    this.widget = widget;

    // Track Select's chosen value on a data attr so getValue can read it.
    if (resolved === 'select') {
      const unsub = widget.on('change', (payload) => {
        const value = (payload as { value?: unknown } | undefined)?.value;
        widget.el.setAttribute('data-jects-edit-value', value == null ? '' : String(value));
      });
      this.off.push(unsub);
      widget.el.setAttribute('data-jects-edit-value', config.value == null ? '' : String(config.value));
    }

    widget.el.classList.add('jects-grid-editor');
    ctx.el.textContent = '';
    ctx.el.appendChild(widget.el);
  }

  getValue(): unknown {
    if (!this.widget) return undefined;
    return readControlValue(this.control, this.widget.el);
  }

  validate(): true | string {
    if (!this.validator) return true;
    return this.validator(this.getValue());
  }

  focus(): void {
    if (this.widget) focusControl(this.widget.el);
  }

  destroy(): void {
    for (const off of this.off) off();
    this.off = [];
    if (this.widget) {
      try {
        this.widget.destroy();
      } catch {
        this.widget.el.remove();
      }
      this.widget = null;
    }
  }

  /** The underlying control widget (for tests / advanced wiring). */
  getWidget(): Widget | null {
    return this.widget as unknown as Widget | null;
  }
}

/**
 * Resolve the effective `CellEditor` for a column: a per-column `editor` wins;
 * otherwise build a `WidgetCellEditor` for the control derived from the type.
 */
export function resolveEditor<Row extends Model>(column: ColumnDef<Row>): CellEditor<Row> {
  if (column.editor) return column.editor;
  return new WidgetCellEditor<Row>(controlForColumn(column));
}

/* ── edit lifecycle controller ─────────────────────────────────────────── */

/** Hooks the controller fires; the engine maps these onto its EditSession/events. */
export interface EditControllerHooks<Row extends Model = Model> {
  /** Vetoable: return `false` to block the edit from starting. */
  beforeStart?(ctx: CellEditContext<Row>): boolean | void;
  /** After the editor mounted + focused. */
  started?(ctx: CellEditContext<Row>): void;
  /** Vetoable: return `false` to block the commit (after validation passes). */
  beforeCommit?(payload: { ctx: CellEditContext<Row>; oldValue: unknown; value: unknown }): boolean | void;
  /** After a successful commit (value written by the caller's `write`). */
  committed?(payload: { ctx: CellEditContext<Row>; oldValue: unknown; value: unknown }): void;
  /** A commit was blocked by validation; receives the message. */
  invalid?(payload: { ctx: CellEditContext<Row>; message: string }): void;
  /** After cancel (no write). */
  cancelled?(ctx: CellEditContext<Row>): void;
  /** Persist a committed value (engine writes to the Store here). */
  write?(payload: { ctx: CellEditContext<Row>; value: unknown }): void;
}

/**
 * Drives a single cell's edit lifecycle over a resolved `CellEditor`. Reusable by
 * the engine: it owns start/commit/cancel with validation + veto, and guarantees
 * the editor is destroyed exactly once. Pure logic — no DOM beyond what the editor
 * itself mounts into `ctx.el`.
 */
export class EditController<Row extends Model = Model> {
  private editor: CellEditor<Row> | null = null;
  private ctx: CellEditContext<Row> | null = null;
  private active = false;

  constructor(private hooks: EditControllerHooks<Row> = {}) {}

  /** Whether an edit is currently in progress. */
  isEditing(): boolean {
    return this.active;
  }

  /** The active edit context, or null. */
  getContext(): CellEditContext<Row> | null {
    return this.ctx;
  }

  /** The active editor instance, or null. */
  getEditor(): CellEditor<Row> | null {
    return this.editor;
  }

  /**
   * Begin editing. Resolves the editor for the column, fires the vetoable
   * `beforeStart`, mounts + focuses. Returns `false` if blocked.
   */
  start(ctx: CellEditContext<Row>, editor?: CellEditor<Row>): boolean {
    if (this.active) {
      // commit (or cancel) the current edit before starting a new one
      if (!this.commit()) this.cancel();
    }
    if (this.hooks.beforeStart?.(ctx) === false) return false;

    this.editor = editor ?? resolveEditor(ctx.column);
    this.ctx = ctx;
    this.active = true;
    this.editor.mount(ctx);
    this.editor.focus?.();
    this.hooks.started?.(ctx);
    return true;
  }

  /**
   * Validate, then commit. Returns `true` on success. On validation failure fires
   * `invalid` and keeps the edit open. A `beforeCommit` veto also keeps it open.
   */
  commit(): boolean {
    if (!this.active || !this.editor || !this.ctx) return false;
    const ctx = this.ctx;

    const validity = this.editor.validate ? this.editor.validate() : true;
    if (validity !== true) {
      this.hooks.invalid?.({ ctx, message: validity });
      return false;
    }

    const value = this.editor.getValue();
    const oldValue = ctx.value;

    if (this.hooks.beforeCommit?.({ ctx, oldValue, value }) === false) {
      return false;
    }

    // Persist via the caller's writer (engine writes to the Store).
    this.hooks.write?.({ ctx, value });

    this.teardown();
    this.hooks.committed?.({ ctx, oldValue, value });
    return true;
  }

  /** Abandon the edit without writing. */
  cancel(): void {
    if (!this.active || !this.ctx) return;
    const ctx = this.ctx;
    this.teardown();
    this.hooks.cancelled?.(ctx);
  }

  /** Destroy any live editor and reset state (idempotent). */
  destroy(): void {
    this.teardown();
  }

  private teardown(): void {
    if (this.editor) {
      try {
        this.editor.destroy();
      } catch {
        /* editor destroy must not throw the lifecycle */
      }
    }
    this.editor = null;
    this.ctx = null;
    this.active = false;
  }
}
