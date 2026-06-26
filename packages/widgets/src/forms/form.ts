/**
 * Form — a declarative form builder.
 *
 * Follows the reference Button pattern: extends `Widget<Config, Events>`,
 * `defaults()` supplies component defaults, `buildEl()` builds the single root
 * once and wires listeners with bound methods (NOT class-field arrows, because
 * `super()` runs `buildEl()` before subclass field initializers), and `render()`
 * idempotently syncs the DOM to config.
 *
 * It composes Wave-1 controls (text/number/textarea/select/combobox/checkbox/
 * radio/switch/date/time/color/file) via the factory `create()`, arranges them
 * through a `layout` (rows × cols, optional fieldsets), and runs a validation
 * engine (required / email / numeric / min / max / minLength / maxLength /
 * pattern / custom / async) producing per-field + form-level errors.
 *
 * Public API: getValue() / setValue() / validate() / reset() / submit() and
 * field-scoped helpers. Events: change / submit / invalid (+ vetoable
 * beforeSubmit).
 */

import {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
  type Unbind,
  createEl,
  register,
  create,
} from '@jects/core';
// Side-effect: register the form-owned `tagsfield` control so the `tags` adapter
// resolves without the consumer importing it separately.
import './tags-field.js';

/** Any Wave-1 control instance, as composed by the form. */
type AnyWidget = Widget<WidgetConfig, WidgetEvents>;

/* ── public types ─────────────────────────────────────────────────────── */

/**
 * The control a field maps to. Spans the Wave-1 inputs (text/number/textarea/
 * select/combobox/checkbox/radio/switch/date/time/color/file), the text-input
 * variants (password/email/url), the chips input (tags), and the richer widgets
 * wired in as form controls (slider/rangeslider/rating/datetime/checkboxgroup).
 */
export type FieldControl =
  | 'text'
  | 'password'
  | 'email'
  | 'url'
  | 'number'
  | 'textarea'
  | 'tags'
  | 'select'
  | 'combobox'
  | 'checkbox'
  | 'checkboxgroup'
  | 'radio'
  | 'switch'
  | 'date'
  | 'time'
  | 'datetime'
  | 'color'
  | 'file'
  | 'slider'
  | 'rangeslider'
  | 'rating';

/** Any value a field control may hold. */
export type FieldValue = unknown;

/** A keyed bag of field values. */
export type FormValues = Record<string, FieldValue>;

/** Result of one validation rule: `true` (or undefined) = valid; string = error. */
export type RuleResult = true | string | undefined | Promise<true | string | undefined>;

/** Declarative validation rules for a single field. */
export interface FieldRules {
  /** Value must be non-empty. `string` overrides the default message. */
  required?: boolean | string;
  /** Value must look like an email. */
  email?: boolean | string;
  /** Value must be a finite number. */
  numeric?: boolean | string;
  /** Minimum numeric value (inclusive). */
  min?: number | { value: number; message: string };
  /** Maximum numeric value (inclusive). */
  max?: number | { value: number; message: string };
  /** Minimum string length. */
  minLength?: number | { value: number; message: string };
  /** Maximum string length. */
  maxLength?: number | { value: number; message: string };
  /** A RegExp (or its source) the string value must match. */
  pattern?: RegExp | string | { value: RegExp | string; message: string };
  /** Synchronous custom rule. Return `true`/undefined to pass, a string to fail. */
  custom?: (value: FieldValue, values: FormValues) => true | string | undefined;
  /** Asynchronous custom rule (e.g. server uniqueness check). */
  asyncValidate?: (value: FieldValue, values: FormValues) => Promise<true | string | undefined>;
}

/**
 * Declarative conditional predicate: the field is shown (or disabled) when the
 * named field's current value strictly equals `eq`. The functional form
 * (`(values) => boolean`) covers everything more complex.
 */
export interface FieldCondition {
  /** The other field whose value is compared. */
  field: string;
  /** The value `field` must strictly equal for the condition to hold. */
  eq: FieldValue;
}

/** A single field declaration in the schema. */
export interface FieldSchema {
  /** Unique key — the property the field reads/writes in the value bag. */
  name: string;
  /** Which Wave-1 control to render. */
  control: FieldControl;
  /** Visible label. */
  label?: string;
  /** Initial value. */
  value?: FieldValue;
  /** Validation rules. */
  rules?: FieldRules;
  /** Column span within its row (1..cols). Default 1. */
  colSpan?: number;
  /** The fieldset group this field belongs to (by `legend`). */
  group?: string;
  /** Extra config passed straight through to the underlying Wave-1 control. */
  props?: Record<string, unknown>;
  /**
   * Conditional visibility, re-evaluated on every change. When the predicate is
   * false the field's cell is hidden AND its validation is skipped (a hidden
   * field can never block submit). Accepts a function over the value bag or the
   * declarative `{ field, eq }` form. A truthy `hidden` flag always wins.
   */
  showWhen?: ((values: FormValues) => boolean) | FieldCondition;
  /** Statically hide the field (still skips validation). */
  hidden?: boolean;
  /** Statically disable the underlying control. */
  disabled?: boolean;
  /** Statically mark the underlying control read-only. */
  readonly?: boolean;
  /**
   * Dynamic disabled predicate, re-evaluated on every change. A truthy static
   * `disabled` flag always wins.
   */
  disabledWhen?: (values: FormValues) => boolean;
}

/** A fieldset grouping (a `<fieldset>` with a `<legend>`). */
export interface FormFieldset {
  /** Legend text — also the `group` key fields reference. */
  legend: string;
  /** Optional description rendered under the legend. */
  description?: string;
}

/** Layout configuration. */
export interface FormLayout {
  /** Number of columns the grid lays fields across. Default 1. */
  cols?: number;
  /** Optional fieldset groups (rendered in order). */
  fieldsets?: FormFieldset[];
}

export interface FormConfig extends WidgetConfig {
  /** The field schema — each entry becomes a Wave-1 control. */
  fields?: FieldSchema[];
  /** Layout (columns + fieldsets). */
  layout?: FormLayout;
  /** Accessible name for the form. */
  ariaLabel?: string;
  /** Submit button text. Set to `null` to omit the submit button. */
  submitText?: string | null;
  /** Reset button text. Omitted when undefined/null. */
  resetText?: string | null;
  /**
   * Validate a field as soon as it changes (default true). Retained for
   * back-compat; when `validateOn` is set it takes precedence. `false` here maps
   * to `validateOn: 'submit'`, `true`/undefined to `validateOn: 'change'`.
   */
  validateOnChange?: boolean;
  /**
   * When per-field validation runs: on every `change` (default), on `blur`
   * (focus leaving the control), or only on `submit`. Supersedes the legacy
   * `validateOnChange` boolean when provided.
   */
  validateOn?: 'change' | 'blur' | 'submit';
  /** Form-level validator run after per-field validation passes. */
  validate?: (values: FormValues) => Record<string, string> | string | undefined | null;
  /** Convenience submit handler (also via `.on('submit', ...)`). */
  onSubmit?: (values: FormValues) => void;
}

export interface FormEvents extends WidgetEvents {
  /** Fired whenever any field value changes. */
  change: { name: string; value: FieldValue; values: FormValues; form: Form };
  /** Fired alongside `change` with the form's current dirty state. */
  dirty: { dirty: boolean; values: FormValues; form: Form };
  /** Vetoable: return `false` to cancel the submit (e.g. to do it yourself). */
  beforeSubmit: { values: FormValues; form: Form };
  /** Fired after a valid submit. */
  submit: { values: FormValues; form: Form };
  /** Fired when validation fails (on submit or programmatic validate). */
  invalid: { errors: Record<string, string>; values: FormValues; form: Form };
}

/* ── result of validate() ─────────────────────────────────────────────── */

export interface ValidationResult {
  valid: boolean;
  /** Field-name → message (form-level errors keyed by '' / field name). */
  errors: Record<string, string>;
}

/* ── per-control adapter ──────────────────────────────────────────────── */

interface ControlAdapter {
  /** Factory `type` to instantiate. */
  type: string;
  /**
   * True when the control renders its OWN error slot wired to its focusable
   * element via `aria-describedby` + `aria-invalid` (TextField and its subclass
   * NumberField, plus TextArea). For these the form pushes the validation
   * message straight into the control (`update({ error })`) instead of rendering
   * its own disconnected error element, so screen readers announce it on focus.
   */
  supportsError?: boolean;
  /** Map a field schema to the control's create() config. */
  toConfig(field: FieldSchema): Record<string, unknown>;
  /** Read the current value from a live control. */
  getValue(w: AnyWidget): FieldValue;
  /** Push a value into a live control. */
  setValue(w: AnyWidget, value: FieldValue): void;
}

/** Read a config key off any widget without per-type imports. */
function cfg(w: AnyWidget): Record<string, unknown> {
  return w.getConfig() as unknown as Record<string, unknown>;
}

/** Patch any widget's config with control-specific keys (untyped at the form level). */
function patch(w: AnyWidget, p: Record<string, unknown>): void {
  (w.update as (p: Record<string, unknown>) => unknown)(p);
}

/**
 * A TextField-backed adapter for a specific native `inputType` (text/password/
 * email/url). All share TextField's own error slot (`supportsError`) and a plain
 * string value.
 */
function textFieldAdapter(inputType: string): ControlAdapter {
  return {
    type: 'textfield',
    supportsError: true,
    toConfig: (f) => ({
      label: f.label,
      ariaLabel: f.label ? undefined : f.name,
      value: f.value ?? '',
      name: f.name,
      inputType,
      ...f.props,
    }),
    getValue: (w) => (cfg(w).value as string) ?? '',
    setValue: (w, v) => patch(w, { value: (v as string) ?? '' }),
  };
}

const ADAPTERS: Record<FieldControl, ControlAdapter> = {
  text: textFieldAdapter('text'),
  password: textFieldAdapter('password'),
  email: textFieldAdapter('email'),
  url: textFieldAdapter('url'),
  number: {
    type: 'numberfield',
    supportsError: true,
    toConfig: (f) => ({
      label: f.label,
      ariaLabel: f.label ? undefined : f.name,
      value: f.value == null ? '' : String(f.value),
      name: f.name,
      ...f.props,
    }),
    getValue: (w) => {
      const raw = (cfg(w).value as string) ?? '';
      return raw === '' ? null : Number(raw);
    },
    setValue: (w, v) => patch(w, { value: v == null ? '' : String(v) }),
  },
  textarea: {
    type: 'textarea',
    supportsError: true,
    toConfig: (f) => ({
      label: f.label,
      ariaLabel: f.label ? undefined : f.name,
      value: f.value ?? '',
      name: f.name,
      ...f.props,
    }),
    getValue: (w) => (cfg(w).value as string) ?? '',
    setValue: (w, v) => patch(w, { value: (v as string) ?? '' }),
  },
  tags: {
    type: 'tagsfield',
    toConfig: (f) => ({
      label: f.label,
      ariaLabel: f.label ? undefined : f.name,
      value: (f.value as string[]) ?? [],
      name: f.name,
      ...f.props,
    }),
    getValue: (w) => (cfg(w).value as string[]) ?? [],
    setValue: (w, v) => patch(w, { value: (v as string[]) ?? [] }),
  },
  select: {
    type: 'select',
    toConfig: (f) => ({ ariaLabel: f.label, value: f.value, name: f.name, ...f.props }),
    getValue: (w) => cfg(w).value,
    setValue: (w, v) => patch(w, { value: v }),
  },
  combobox: {
    type: 'combobox',
    toConfig: (f) => ({ ariaLabel: f.label, value: f.value, name: f.name, ...f.props }),
    getValue: (w) => {
      const c = cfg(w);
      return c.multiple ? (c.values ?? []) : c.value;
    },
    setValue: (w, v) => {
      const c = cfg(w);
      if (c.multiple) patch(w, { values: (v as string[]) ?? [] });
      else patch(w, { value: v });
    },
  },
  checkbox: {
    type: 'checkbox',
    toConfig: (f) => ({ label: f.label, checked: !!f.value, name: f.name, ...f.props }),
    getValue: (w) => !!cfg(w).checked,
    setValue: (w, v) => patch(w, { checked: !!v }),
  },
  checkboxgroup: {
    type: 'checkboxgroup',
    toConfig: (f) => ({
      ariaLabel: f.label,
      value: (f.value as string[]) ?? [],
      name: f.name,
      ...f.props,
    }),
    getValue: (w) => (cfg(w).value as string[]) ?? [],
    setValue: (w, v) => patch(w, { value: (v as string[]) ?? [] }),
  },
  radio: {
    type: 'radiogroup',
    toConfig: (f) => ({ ariaLabel: f.label, value: f.value, name: f.name, ...f.props }),
    getValue: (w) => cfg(w).value,
    setValue: (w, v) => patch(w, { value: v }),
  },
  switch: {
    type: 'switch',
    toConfig: (f) => ({ label: f.label, checked: !!f.value, name: f.name, ...f.props }),
    getValue: (w) => !!cfg(w).checked,
    setValue: (w, v) => patch(w, { checked: !!v }),
  },
  date: {
    type: 'datepicker',
    toConfig: (f) => ({ value: (f.value as Date | null) ?? null, ...f.props }),
    getValue: (w) => cfg(w).value ?? null,
    setValue: (w, v) => patch(w, { value: (v as Date | null) ?? null }),
  },
  time: {
    type: 'timepicker',
    toConfig: (f) => ({ value: f.value ?? null, ...f.props }),
    getValue: (w) => cfg(w).value ?? null,
    setValue: (w, v) => patch(w, { value: v ?? null }),
  },
  datetime: {
    type: 'datetimefield',
    toConfig: (f) => ({ value: (f.value as Date | null) ?? null, ...f.props }),
    getValue: (w) => cfg(w).value ?? null,
    setValue: (w, v) => patch(w, { value: (v as Date | null) ?? null }),
  },
  color: {
    type: 'colorpicker',
    toConfig: (f) => ({ value: (f.value as string) ?? '#000000', ...f.props }),
    getValue: (w) => (cfg(w).value as string) ?? '',
    setValue: (w, v) => patch(w, { value: (v as string) ?? '#000000' }),
  },
  slider: {
    type: 'slider',
    toConfig: (f) => ({ label: f.label, value: (f.value as number) ?? 0, ...f.props }),
    getValue: (w) => (cfg(w).value as number) ?? 0,
    setValue: (w, v) => patch(w, { value: (v as number) ?? 0 }),
  },
  rangeslider: {
    type: 'rangeslider',
    // Value is a `{ low, high }` pair mirroring the widget's own config keys.
    toConfig: (f) => {
      const r = (f.value as { low?: number; high?: number } | undefined) ?? {};
      return { low: r.low, high: r.high, ...f.props };
    },
    getValue: (w) => {
      const c = cfg(w);
      return { low: (c.low as number) ?? 0, high: (c.high as number) ?? 0 };
    },
    setValue: (w, v) => {
      const r = (v as { low?: number; high?: number } | null) ?? {};
      if (r && typeof r === 'object') patch(w, { low: r.low, high: r.high });
    },
  },
  rating: {
    type: 'rating',
    toConfig: (f) => ({ label: f.label, value: (f.value as number) ?? 0, ...f.props }),
    getValue: (w) => (cfg(w).value as number) ?? 0,
    setValue: (w, v) => patch(w, { value: (v as number) ?? 0 }),
  },
  file: {
    type: 'filepicker',
    toConfig: (f) => ({ label: f.label, ...f.props }),
    // FilePicker tracks entries internally; expose them via a getValue() method if present.
    getValue: (w) => {
      const maybe = w as unknown as { getValue?: () => unknown };
      if (typeof maybe.getValue === 'function') return maybe.getValue();
      return [];
    },
    setValue: () => {
      /* files are user-driven; programmatic set is a no-op */
    },
  },
};

/* ── live field record ────────────────────────────────────────────────── */

interface LiveField {
  schema: FieldSchema;
  widget: AnyWidget;
  adapter: ControlAdapter;
  /** Host cell wrapping the control + its error slot. */
  cell: HTMLElement;
  /**
   * Form-owned external error element. `null` for controls that render their own
   * error slot (`adapter.supportsError`) — those receive the message via
   * `update({ error })` so it is wired to the control's `aria-describedby`.
   */
  errorEl: HTMLElement | null;
  /** Stable id of the error region (form-owned or the control's own). */
  errorId: string;
  /** Last validation message (empty = valid). */
  error: string;
  /** Last computed conditional-visibility state (drives the cell's `hidden`). */
  visible: boolean;
  /** Last computed disabled state (static `disabled` or `disabledWhen`). */
  disabled: boolean;
}

/* ── the component ────────────────────────────────────────────────────── */

let formSeq = 0;

export class Form extends Widget<FormConfig, FormEvents> {
  /** name → live field. Built lazily in render(); never a class-field initializer. */
  private get fieldMap(): Map<string, LiveField> {
    const store = this.el as unknown as { _jectsFields?: Map<string, LiveField> };
    if (!store._jectsFields) store._jectsFields = new Map();
    return store._jectsFields;
  }

  /**
   * Per-render field-change unbinders. Tracked SEPARATELY from the base Widget
   * lifetime `disposers` so each re-render can drain the previous render's
   * unbinders instead of leaking them. Stored lazily on `this.el` because
   * `render()` runs inside `super()` BEFORE any subclass field initializer would
   * assign a class-field array (which would otherwise clobber it post-construct).
   */
  private get fieldOffs(): Unbind[] {
    const store = this.el as unknown as { _jectsFieldOffs?: Unbind[] };
    if (!store._jectsFieldOffs) store._jectsFieldOffs = [];
    return store._jectsFieldOffs;
  }

  /**
   * Dirty-tracking state, stored lazily on `this.el` (NOT a class field) for the
   * same construction-order reason as `fieldMap`: `render()` runs inside
   * `super()` before any subclass field initializer would assign it.
   *
   * `initial` is the value bag snapshotted once after the first field build;
   * `touched` is the set of field names that have fired a `change`.
   */
  private get dirtyState(): { initial?: FormValues; touched: Set<string> } {
    const store = this.el as unknown as {
      _jectsDirty?: { initial?: FormValues; touched: Set<string> };
    };
    if (!store._jectsDirty) store._jectsDirty = { touched: new Set() };
    return store._jectsDirty;
  }

  protected get formId(): string {
    let id = this.el.dataset.formId;
    if (!id) {
      id = `jects-form-${++formSeq}`;
      this.el.dataset.formId = id;
    }
    return id;
  }

  protected override defaults(): Partial<FormConfig> {
    return {
      fields: [],
      layout: { cols: 1 },
      submitText: 'Submit',
      validateOnChange: true,
    };
  }

  protected buildEl(): HTMLElement {
    const form = createEl('form', { className: 'jects-form' });
    // Bound listeners (super() runs buildEl() before field initializers).
    form.addEventListener('submit', (e) => this.handleSubmit(e));
    form.addEventListener('reset', (e) => this.handleReset(e));
    return form;
  }

  /* ── DOM event handlers ─────────────────────────────────────────────── */

  private handleSubmit(event: Event): void {
    event.preventDefault();
    void this.submit();
  }

  private handleReset(event: Event): void {
    event.preventDefault();
    this.reset();
  }

  private onFieldChange(name: string): void {
    const field = this.fieldMap.get(name);
    if (!field) return;
    this.dirtyState.touched.add(name);
    const value = field.adapter.getValue(field.widget);
    if (this.validationMode() === 'change') {
      void this.validateField(name);
    }
    // Conditional visibility + disabledWhen depend on the value bag, so re-sync
    // every field's state on each change.
    this.syncFieldStates();
    const values = this.getValue();
    this.emit('change', { name, value, values, form: this });
    this.emit('dirty', { dirty: this.isDirty(), values, form: this });
  }

  /** Fired when focus leaves a control — used by `validateOn: 'blur'`. */
  private onFieldBlur(name: string): void {
    if (this.validationMode() === 'blur') void this.validateField(name);
  }

  /** Resolve the effective validation mode (new `validateOn` wins; else legacy). */
  private validationMode(): 'change' | 'blur' | 'submit' {
    if (this.config.validateOn) return this.config.validateOn;
    return this.config.validateOnChange === false ? 'submit' : 'change';
  }

  /* ── building the form tree ─────────────────────────────────────────── */

  protected override render(): void {
    const { ariaLabel, submitText, resetText } = this.config;

    this.el.className = ['jects-form', this.config.cls ?? ''].filter(Boolean).join(' ');
    if (ariaLabel) this.el.setAttribute('aria-label', ariaLabel);
    else this.el.removeAttribute('aria-label');
    (this.el as HTMLFormElement).noValidate = true;

    // Build once: if the body already exists, only the schema can have changed.
    // We rebuild the field tree from scratch on (re)render for correctness, but
    // dispose old widgets first so listeners/DOM never leak.
    this.teardownFields();
    this.el.replaceChildren();

    const body = createEl('div', { className: 'jects-form__body' });
    this.el.append(body);
    this.buildFields(body);

    // Snapshot the pristine value bag ONCE (after the first build) so dirty
    // tracking compares against the original schema values, not the latest
    // re-render. Apply conditional visibility + disabled state immediately.
    if (!this.dirtyState.initial) this.dirtyState.initial = this.getValue();
    this.syncFieldStates();

    // Actions row.
    if (submitText != null || (resetText != null && resetText !== undefined)) {
      const actions = createEl('div', { className: 'jects-form__actions' });
      if (resetText != null) {
        const resetBtn = createEl('button', {
          className: 'jects-form__reset',
          attrs: { type: 'reset' },
        });
        resetBtn.textContent = resetText;
        actions.append(resetBtn);
      }
      if (submitText != null) {
        const submitBtn = createEl('button', {
          className: 'jects-form__submit',
          attrs: { type: 'submit' },
        });
        submitBtn.textContent = submitText;
        actions.append(submitBtn);
      }
      this.el.append(actions);
    }

    // Form-level error region.
    const formError = createEl('div', {
      className: 'jects-form__error',
      attrs: { id: `${this.formId}-error`, role: 'alert', 'aria-live': 'polite' },
    });
    formError.hidden = true;
    this.el.append(formError);
  }

  /** Instantiate Wave-1 controls per the schema, grouped by fieldset/row layout. */
  private buildFields(body: HTMLElement): void {
    const fields = this.config.fields ?? [];
    const layout = this.config.layout ?? {};
    const cols = Math.max(1, layout.cols ?? 1);
    const fieldsets = layout.fieldsets ?? [];

    // Group fields by fieldset legend; ungrouped go in a default bucket first.
    const ungrouped = fields.filter((f) => !f.group);
    if (ungrouped.length) {
      const grid = this.makeGrid(cols);
      body.append(grid);
      for (const f of ungrouped) grid.append(this.buildCell(f, cols));
    }

    for (const set of fieldsets) {
      const groupFields = fields.filter((f) => f.group === set.legend);
      if (!groupFields.length) continue;
      const fs = createEl('fieldset', { className: 'jects-form__fieldset' });
      const legend = createEl('legend', { className: 'jects-form__legend' });
      legend.textContent = set.legend;
      fs.append(legend);
      if (set.description) {
        const desc = createEl('p', { className: 'jects-form__description' });
        desc.textContent = set.description;
        fs.append(desc);
      }
      const grid = this.makeGrid(cols);
      fs.append(grid);
      for (const f of groupFields) grid.append(this.buildCell(f, cols));
      body.append(fs);
    }
  }

  private makeGrid(cols: number): HTMLElement {
    const grid = createEl('div', { className: 'jects-form__grid' });
    grid.style.setProperty('--_form-cols', String(cols));
    return grid;
  }

  private buildCell(schema: FieldSchema, cols: number): HTMLElement {
    const adapter = ADAPTERS[schema.control];
    if (!adapter) {
      throw new Error(`Jects Form: unknown field control "${schema.control}" for field "${schema.name}".`);
    }

    const cell = createEl('div', { className: 'jects-form__cell' });
    const span = Math.min(Math.max(1, schema.colSpan ?? 1), cols);
    cell.style.setProperty('--_form-span', String(span));
    cell.dataset.field = schema.name;

    // The control mounts into a dedicated holder so we own teardown of its el.
    const holder = createEl('div', { className: 'jects-form__control' });
    cell.append(holder);

    // Static disabled/readonly are pushed into the control's create() config so
    // it renders in the right state from frame one; dynamic `disabledWhen` is
    // applied right after the full build via syncFieldStates(). `readOnly` is the
    // camelCase key the text-like + rating controls read; controls without it
    // simply ignore the extra key.
    const stateProps: Record<string, unknown> = {};
    if (schema.disabled) stateProps.disabled = true;
    if (schema.readonly) stateProps.readOnly = true;

    const widget = create(
      { type: adapter.type, ...adapter.toConfig(schema), ...stateProps },
      holder,
    );

    // Wire change → revalidate + bubble. Track the unbinder in the per-render
    // `fieldOffs` list (NOT the base `disposers`) so teardownFields() can drain
    // it on every re-render — otherwise each update() would append a permanent
    // entry whose closure pins the (then-destroyed) widget, growing without
    // bound and defeating GC.
    const off = widget.on('change' as never, (() => this.onFieldChange(schema.name)) as never);
    this.fieldOffs.push(off);

    // Blur validation (validateOn: 'blur'): listen for focus leaving the control.
    // Tracked in fieldOffs so it is drained on every re-render alongside `off`.
    const onBlur = (): void => this.onFieldBlur(schema.name);
    widget.el.addEventListener('focusout', onBlur);
    this.fieldOffs.push(() => widget.el.removeEventListener('focusout', onBlur));

    const errorId = `${this.formId}-${cssId(schema.name)}-error`;

    // Controls with their own error slot (text/number/textarea) get the message
    // pushed in via update({ error }) — which wires the control's own
    // aria-describedby — so we DON'T render a second, programmatically
    // disconnected error element here. All other controls keep a form-owned
    // error region whose id we point the control's focusable element at.
    let errorEl: HTMLElement | null = null;
    if (!adapter.supportsError) {
      errorEl = createEl('div', {
        className: 'jects-form__field-error',
        attrs: { id: errorId, role: 'alert' },
      });
      errorEl.hidden = true;
      cell.append(errorEl);
    }

    this.fieldMap.set(schema.name, {
      schema,
      widget,
      adapter,
      cell,
      errorEl,
      errorId,
      error: '',
      // Resolved by syncFieldStates() right after the full build.
      visible: true,
      disabled: !!schema.disabled,
    });

    return cell;
  }

  /** Destroy all live field widgets, drain per-render listeners, clear the map. */
  private teardownFields(): void {
    // Unbind this render's field-change listeners first so their closures release
    // the widgets and field names (do this even though child destroy() clears the
    // emitter — the unbinders must also leave our tracking list so they cannot
    // accumulate across renders).
    for (const off of this.fieldOffs.splice(0)) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    for (const f of this.fieldMap.values()) {
      try {
        f.widget.destroy();
      } catch {
        /* ignore */
      }
    }
    this.fieldMap.clear();
  }

  /* ── conditional state (visibility + disabled) ──────────────────────── */

  /** Whether a field is currently visible (static `hidden` / `showWhen`). */
  private isVisible(schema: FieldSchema, values: FormValues): boolean {
    if (schema.hidden) return false;
    const sw = schema.showWhen;
    if (sw == null) return true;
    if (typeof sw === 'function') return !!sw(values);
    return values[sw.field] === sw.eq;
  }

  /** Whether a field is currently disabled (static `disabled` / `disabledWhen`). */
  private isDisabled(schema: FieldSchema, values: FormValues): boolean {
    if (schema.disabled) return true;
    if (schema.disabledWhen) return !!schema.disabledWhen(values);
    return false;
  }

  /**
   * Re-evaluate every field's conditional visibility + disabled state against
   * the current value bag and reflect it onto the DOM/control. Hiding a field
   * also clears any standing error so it can never block submit. Runs after the
   * initial build and on every change.
   */
  private syncFieldStates(): void {
    const values = this.getValue();
    for (const [name, f] of this.fieldMap) {
      const visible = this.isVisible(f.schema, values);
      f.visible = visible;
      f.cell.hidden = !visible;
      if (!visible && f.error) this.applyFieldError(name, '');

      const disabled = this.isDisabled(f.schema, values);
      if (disabled !== f.disabled) {
        f.disabled = disabled;
        try {
          f.widget.update({ disabled } as never);
        } catch {
          /* control may not support disabled */
        }
      }
    }
  }

  /* ── value API ──────────────────────────────────────────────────────── */

  /** The current value bag (every field, by name). */
  getValue(): FormValues {
    const out: FormValues = {};
    for (const [name, f] of this.fieldMap) {
      out[name] = f.adapter.getValue(f.widget);
    }
    return out;
  }

  /** Read one field's current value. */
  getFieldValue(name: string): FieldValue {
    const f = this.fieldMap.get(name);
    return f ? f.adapter.getValue(f.widget) : undefined;
  }

  /** Patch one or many field values. */
  setValue(values: FormValues): this {
    for (const [name, value] of Object.entries(values)) {
      const f = this.fieldMap.get(name);
      if (f) f.adapter.setValue(f.widget, value);
    }
    return this;
  }

  /** Set a single field's value. */
  setFieldValue(name: string, value: FieldValue): this {
    const f = this.fieldMap.get(name);
    if (f) f.adapter.setValue(f.widget, value);
    return this;
  }

  /* ── validation engine ──────────────────────────────────────────────── */

  /** Validate the whole form (async-aware). Renders errors and emits `invalid`. */
  async validate(): Promise<ValidationResult> {
    const values = this.getValue();
    const errors: Record<string, string> = {};

    for (const [name, f] of this.fieldMap) {
      // Hidden fields are skipped entirely — they can never block submit.
      if (!this.isVisible(f.schema, values)) {
        this.applyFieldError(name, '');
        continue;
      }
      const msg = await runRules(f.schema.rules, f.adapter.getValue(f.widget), values);
      this.applyFieldError(name, msg ?? '');
      if (msg) errors[name] = msg;
    }

    // Form-level cross-field validation only when fields individually pass.
    if (Object.keys(errors).length === 0 && this.config.validate) {
      const formResult = this.config.validate(values);
      if (typeof formResult === 'string') {
        errors[''] = formResult;
      } else if (formResult && typeof formResult === 'object') {
        for (const [name, msg] of Object.entries(formResult)) {
          if (!msg) continue;
          errors[name] = msg;
          if (name === '') continue;
          this.applyFieldError(name, msg);
        }
      }
    }

    this.applyFormError(errors[''] ?? '');

    const valid = Object.keys(errors).length === 0;
    if (!valid) this.emit('invalid', { errors, values, form: this });
    return { valid, errors };
  }

  /** Validate a single field; returns its message (empty = valid). */
  async validateField(name: string): Promise<string> {
    const f = this.fieldMap.get(name);
    if (!f) return '';
    // Hidden fields never validate.
    if (!this.isVisible(f.schema, this.getValue())) {
      this.applyFieldError(name, '');
      return '';
    }
    const msg = (await runRules(f.schema.rules, f.adapter.getValue(f.widget), this.getValue())) ?? '';
    this.applyFieldError(name, msg);
    return msg;
  }

  private applyFieldError(name: string, msg: string): void {
    const f = this.fieldMap.get(name);
    if (!f) return;
    f.error = msg;
    f.cell.classList.toggle('jects-form__cell--invalid', !!msg);

    if (f.adapter.supportsError) {
      // The control owns its error slot: push the message in so the control's own
      // aria-describedby + aria-invalid announce it on focus. No external,
      // disconnected error element is rendered for these controls.
      try {
        f.widget.update({ error: msg, invalid: !!msg } as never);
      } catch {
        /* control may not support error/invalid */
      }
      return;
    }

    // Form-owned external error region for every other control type.
    if (f.errorEl) {
      f.errorEl.textContent = msg;
      f.errorEl.hidden = !msg;
    }

    // Reflect invalidity onto the control config where it supports it (swallowed
    // if not) so controls with an `invalid` flag style + expose aria-invalid.
    try {
      f.widget.update({ invalid: !!msg } as never);
    } catch {
      /* control may not support invalid */
    }

    // Regardless of control type, expose the invalid state AND associate the
    // form-owned error message on the control's actual focusable element. This
    // covers select / combobox / radiogroup / checkbox / switch / date / time /
    // color / file — none of which receive the message any other way — so AT
    // announces both the invalid state and *why* when the control is focused.
    const focusable = this.focusableOf(f);
    if (focusable) {
      if (msg) {
        focusable.setAttribute('aria-invalid', 'true');
        this.associateDescription(focusable, f.errorId);
      } else {
        focusable.removeAttribute('aria-invalid');
        this.dissociateDescription(focusable, f.errorId);
      }
    }
  }

  /** The control's primary focusable element (where ARIA state must live). */
  private focusableOf(f: LiveField): HTMLElement | null {
    // Prefer a genuinely-interactive descendant; fall back to anything carrying a
    // widget role or tabindex. Query directly (not getFocusable) so this also
    // resolves in jsdom where offsetParent is always null.
    const root = f.widget.el;
    return root.querySelector<HTMLElement>(
      'input, select, textarea, button, [tabindex], [role="combobox"], [role="radiogroup"], [role="listbox"], [role="switch"], [role="checkbox"]',
    );
  }

  /** Add `id` to an element's `aria-describedby` token list (idempotent). */
  private associateDescription(el: HTMLElement, id: string): void {
    const existing = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    if (!existing.includes(id)) existing.push(id);
    el.setAttribute('aria-describedby', existing.join(' '));
  }

  /** Remove `id` from an element's `aria-describedby` token list. */
  private dissociateDescription(el: HTMLElement, id: string): void {
    const existing = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    const next = existing.filter((t) => t !== id);
    if (next.length) el.setAttribute('aria-describedby', next.join(' '));
    else el.removeAttribute('aria-describedby');
  }

  private applyFormError(msg: string): void {
    const el = this.el.querySelector('.jects-form__error') as HTMLElement | null;
    if (!el) return;
    el.textContent = msg;
    el.hidden = !msg;
  }

  /* ── lifecycle actions ──────────────────────────────────────────────── */

  /** Validate then (if valid and not vetoed) emit `submit`. Returns success. */
  async submit(): Promise<boolean> {
    const result = await this.validate();
    if (!result.valid) return false;
    const values = this.getValue();
    if (this.emit('beforeSubmit', { values, form: this }) === false) return false;
    this.config.onSubmit?.(values);
    this.emit('submit', { values, form: this });
    return true;
  }

  /** Reset every field to its schema's initial value and clear all errors + dirt. */
  reset(): this {
    for (const [name, f] of this.fieldMap) {
      f.adapter.setValue(f.widget, f.schema.value ?? defaultFor(f.schema.control));
      this.applyFieldError(name, '');
    }
    this.applyFormError('');
    // Clearing the touched set + re-syncing conditional state returns the form to
    // its pristine (non-dirty) baseline.
    this.dirtyState.touched.clear();
    this.syncFieldStates();
    const values = this.getValue();
    this.emit('dirty', { dirty: this.isDirty(), values, form: this });
    return this;
  }

  /* ── dirty tracking ─────────────────────────────────────────────────── */

  /** The pristine value snapshot captured at first build (empty before build). */
  private getInitial(): FormValues {
    return this.dirtyState.initial ?? {};
  }

  /** Whether any field's current value differs from its pristine snapshot. */
  isDirty(): boolean {
    const cur = this.getValue();
    const init = this.getInitial();
    for (const name of this.fieldMap.keys()) {
      if (!valueEqual(cur[name], init[name])) return true;
    }
    return false;
  }

  /** Whether one field's value differs from its pristine snapshot. */
  isFieldDirty(name: string): boolean {
    if (!this.fieldMap.has(name)) return false;
    return !valueEqual(this.getFieldValue(name), this.getInitial()[name]);
  }

  /** The subset of the value bag whose fields are dirty (name → current value). */
  getDirtyValues(): FormValues {
    const cur = this.getValue();
    const init = this.getInitial();
    const out: FormValues = {};
    for (const name of this.fieldMap.keys()) {
      if (!valueEqual(cur[name], init[name])) out[name] = cur[name];
    }
    return out;
  }

  /** Field names that have fired at least one change since build/reset. */
  getTouched(): string[] {
    return [...this.dirtyState.touched];
  }

  /** Currently-displayed errors (field name → message). */
  getErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, f] of this.fieldMap) if (f.error) out[name] = f.error;
    const formErr = this.el.querySelector('.jects-form__error') as HTMLElement | null;
    if (formErr && formErr.textContent) out[''] = formErr.textContent;
    return out;
  }

  /** Access a live field's underlying Wave-1 widget. */
  getField(name: string): AnyWidget | undefined {
    return this.fieldMap.get(name)?.widget;
  }

  override destroy(): void {
    if (this.isDestroyed) return;
    // Dispose field widgets before the base disposes our tracked unbinders/DOM.
    this.teardownFields();
    super.destroy();
  }
}

/* ── rule runner ──────────────────────────────────────────────────────── */

function isEmpty(v: FieldValue): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'boolean') return v === false;
  return false;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Run all rules for a field; resolves to the first failing message (or undefined). */
async function runRules(
  rules: FieldRules | undefined,
  value: FieldValue,
  values: FormValues,
): Promise<string | undefined> {
  if (!rules) return undefined;

  if (rules.required) {
    if (isEmpty(value)) return msgOf(rules.required, 'This field is required.');
  }

  // Remaining rules are skipped for empty optional values.
  const empty = isEmpty(value);

  if (!empty && rules.email) {
    if (typeof value !== 'string' || !EMAIL_RE.test(value)) {
      return msgOf(rules.email, 'Enter a valid email address.');
    }
  }

  if (!empty && rules.numeric) {
    if (!isNumeric(value)) return msgOf(rules.numeric, 'Enter a valid number.');
  }

  if (!empty && rules.min != null) {
    const { value: m, message } = unpack(rules.min, (n) => `Must be at least ${n}.`);
    if (isNumeric(value) && Number(value) < m) return message;
  }

  if (!empty && rules.max != null) {
    const { value: m, message } = unpack(rules.max, (n) => `Must be at most ${n}.`);
    if (isNumeric(value) && Number(value) > m) return message;
  }

  if (!empty && rules.minLength != null) {
    const { value: m, message } = unpack(rules.minLength, (n) => `Must be at least ${n} characters.`);
    if (lengthOf(value) < m) return message;
  }

  if (!empty && rules.maxLength != null) {
    const { value: m, message } = unpack(rules.maxLength, (n) => `Must be at most ${n} characters.`);
    if (lengthOf(value) > m) return message;
  }

  if (!empty && rules.pattern != null) {
    const { re, message } = unpackPattern(rules.pattern);
    if (typeof value === 'string' && !re.test(value)) return message;
  }

  if (rules.custom) {
    const r = rules.custom(value, values);
    if (typeof r === 'string') return r;
  }

  if (rules.asyncValidate) {
    const r = await rules.asyncValidate(value, values);
    if (typeof r === 'string') return r;
  }

  return undefined;
}

function isNumeric(v: FieldValue): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string' && v.trim() !== '') return Number.isFinite(Number(v));
  return false;
}

function lengthOf(v: FieldValue): number {
  if (typeof v === 'string') return v.length;
  if (Array.isArray(v)) return v.length;
  return String(v ?? '').length;
}

function msgOf(rule: boolean | string, fallback: string): string {
  return typeof rule === 'string' ? rule : fallback;
}

function unpack(
  rule: number | { value: number; message: string },
  fallback: (n: number) => string,
): { value: number; message: string } {
  if (typeof rule === 'number') return { value: rule, message: fallback(rule) };
  return rule;
}

function unpackPattern(
  rule: RegExp | string | { value: RegExp | string; message: string },
): { re: RegExp; message: string } {
  if (rule instanceof RegExp) return { re: rule, message: 'Invalid format.' };
  if (typeof rule === 'string') return { re: new RegExp(rule), message: 'Invalid format.' };
  const re = rule.value instanceof RegExp ? rule.value : new RegExp(rule.value);
  return { re, message: rule.message };
}

function defaultFor(control: FieldControl): FieldValue {
  switch (control) {
    case 'checkbox':
    case 'switch':
      return false;
    case 'number':
      return null;
    case 'date':
    case 'time':
    case 'datetime':
      return null;
    case 'file':
    case 'tags':
    case 'checkboxgroup':
      return [];
    case 'slider':
    case 'rating':
      return 0;
    case 'rangeslider':
      return null;
    default:
      return '';
  }
}

/**
 * Structural value equality for dirty tracking. Handles the value shapes the
 * adapters produce: primitives, `Date` instants, arrays (tags / checkbox group),
 * and `{ low, high }` range objects.
 */
function valueEqual(a: FieldValue, b: FieldValue): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => valueEqual(x, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    return ak.every((k) =>
      valueEqual((a as Record<string, FieldValue>)[k], (b as Record<string, FieldValue>)[k]),
    );
  }
  return false;
}

/** Make a field name safe to embed in an element id. */
function cssId(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-');
}

register(
  'form',
  Form as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Form,
);
