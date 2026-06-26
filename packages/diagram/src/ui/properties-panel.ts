/**
 * Properties panel for the Diagram editor. Reuses `@jects/widgets` field controls
 * (TextField / NumberField / Select / TextArea) bound to the currently selected
 * shape or connector. Edits are pushed back through an `onChange` callback the
 * widget wires to `engine.updateShape` / `engine.updateConnector`, so the panel
 * stays a thin, declarative view over the model.
 */
import { Widget, createEl, type WidgetConfig, type WidgetEvents } from '@jects/core';
import {
  TextField,
  NumberField,
  Select,
  type SelectOption,
} from '@jects/widgets';
import type {
  ArrowHead,
  ConnectorKind,
  ConnectorModel,
  DiagramId,
  DiagramStyle,
  ShapeModel,
} from '../contract.js';

export type PanelTarget =
  | { kind: 'shape'; model: ShapeModel }
  | { kind: 'connector'; model: ConnectorModel }
  | { kind: 'none' };

export interface PropertiesPanelConfig extends WidgetConfig {
  target?: PanelTarget;
  /** Called when a property changes: id + partial patch for that element. */
  onShapeChange?: (id: DiagramId, patch: Partial<ShapeModel>) => void;
  onConnectorChange?: (id: DiagramId, patch: Partial<ConnectorModel>) => void;
}

export interface PropertiesPanelEvents extends WidgetEvents {
  edit: { id: DiagramId };
}

const CONNECTOR_KINDS: ConnectorKind[] = ['straight', 'elbow', 'orthogonal', 'curved'];

const ARROW_HEADS: ArrowHead[] = ['none', 'arrow', 'triangle', 'diamond', 'circle', 'open'];

/**
 * Merge a style patch onto a base style, deleting any key whose patched value is
 * `undefined` (so "Default" selections clear the override rather than persisting
 * an `undefined` — required under `exactOptionalPropertyTypes`).
 */
function mergeStyle(
  base: DiagramStyle | undefined,
  over: Record<string, unknown>,
): DiagramStyle {
  const next: DiagramStyle = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return next;
}

/**
 * Token-name palette offered for fill / stroke / text-color selects. Values are
 * `--jects-*` token NAMES (the renderer maps them to `oklch(var(--jects-<name>))`),
 * keeping the panel token-pure — no raw color literals. `''` = inherit/default.
 */
const FILL_TOKENS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Default' },
  { value: 'card', label: 'Card' },
  { value: 'background', label: 'Background' },
  { value: 'muted', label: 'Muted' },
  { value: 'primary', label: 'Primary' },
  { value: 'secondary', label: 'Secondary' },
  { value: 'accent', label: 'Accent' },
  { value: 'success', label: 'Success' },
  { value: 'destructive', label: 'Destructive' },
];

const STROKE_TOKENS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Default' },
  { value: 'border', label: 'Border' },
  { value: 'foreground', label: 'Foreground' },
  { value: 'primary', label: 'Primary' },
  { value: 'muted-foreground', label: 'Muted' },
  { value: 'destructive', label: 'Destructive' },
];

const TEXT_TOKENS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Default' },
  { value: 'foreground', label: 'Foreground' },
  { value: 'card-foreground', label: 'Card' },
  { value: 'muted-foreground', label: 'Muted' },
  { value: 'primary', label: 'Primary' },
  { value: 'primary-foreground', label: 'On primary' },
];

export class PropertiesPanel extends Widget<
  PropertiesPanelConfig,
  PropertiesPanelEvents
> {
  private declare bodyEl: HTMLElement;
  private declare children: Widget[];

  protected override defaults(): Partial<PropertiesPanelConfig> {
    return { target: { kind: 'none' } };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-diagram-props' });
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Properties');
    const heading = createEl('div', { className: 'jects-diagram-props__title' });
    heading.textContent = 'Properties';
    const body = createEl('div', { className: 'jects-diagram-props__body' });
    root.append(heading, body);
    this.bodyEl = body;
    this.children = [];
    return root;
  }

  private disposeChildren(): void {
    for (const c of this.children ?? []) c.destroy();
    this.children = [];
    this.bodyEl?.replaceChildren();
  }

  private field(label: string): HTMLElement {
    const wrap = createEl('div', { className: 'jects-diagram-props__field' });
    // Presentational caption only: the bare <label> is NOT associated with any
    // control (the @jects/widgets host is a sibling, not nested), so render it as
    // a plain <div> to avoid an orphaned form label. Each control below supplies
    // its own accessible name via the widget's `ariaLabel` config.
    const lab = createEl('div', { className: 'jects-diagram-props__label' });
    lab.textContent = label;
    wrap.appendChild(lab);
    this.bodyEl.appendChild(wrap);
    return wrap;
  }

  protected override render(): void {
    if (!this.bodyEl) return;
    this.disposeChildren();
    const target = this.config.target ?? { kind: 'none' };

    if (target.kind === 'none') {
      const empty = createEl('div', { className: 'jects-diagram-props__empty' });
      empty.textContent = 'Nothing selected';
      this.bodyEl.appendChild(empty);
      return;
    }

    if (target.kind === 'shape') {
      this.renderShape(target.model);
    } else {
      this.renderConnector(target.model);
    }
  }

  private renderShape(shape: ShapeModel): void {
    const textHost = this.field('Text');
    const text = new TextField(textHost, {
      value: shape.text ?? '',
      placeholder: 'Label',
      ariaLabel: 'Text',
    });
    text.on('change', (p: { value: string }) => {
      this.config.onShapeChange?.(shape.id, { text: p.value });
      this.emit('edit', { id: shape.id });
    });
    this.children.push(text);

    const posHost = this.field('Position & Size');
    const grid = createEl('div', { className: 'jects-diagram-props__grid' });
    posHost.appendChild(grid);
    const num = (
      labelText: string,
      ariaName: string,
      value: number,
      apply: (v: number) => Partial<ShapeModel>,
    ): void => {
      const cell = createEl('div', { className: 'jects-diagram-props__cell' });
      const lab = createEl('span', { className: 'jects-diagram-props__sublabel' });
      lab.textContent = labelText;
      lab.setAttribute('aria-hidden', 'true');
      const host = createEl('div');
      cell.append(lab, host);
      grid.appendChild(cell);
      const f = new NumberField(host, { value: String(value), ariaLabel: ariaName });
      f.on(
        'change' as never,
        ((p: { numericValue: number | null }) => {
          if (p.numericValue == null) return;
          this.config.onShapeChange?.(shape.id, apply(p.numericValue));
          this.emit('edit', { id: shape.id });
        }) as never,
      );
      this.children.push(f);
    };
    num('X', 'X position', Math.round(shape.x), (v) => ({ x: v }));
    num('Y', 'Y position', Math.round(shape.y), (v) => ({ y: v }));
    num('W', 'Width', Math.round(shape.w), (v) => ({ w: Math.max(1, v) }));
    num('H', 'Height', Math.round(shape.h), (v) => ({ h: Math.max(1, v) }));

    // ── Style controls (fill / stroke / strokeWidth / textColor / fontSize) ──
    // Each edit merges onto the existing style so unrelated keys are preserved.
    const patchStyle = (over: Record<string, unknown>): void => {
      const next = mergeStyle(shape.style, over);
      this.config.onShapeChange?.(shape.id, { style: next });
      this.emit('edit', { id: shape.id });
    };

    this.styleTokenSelect('Fill', 'Fill color', FILL_TOKENS, shape.style?.fill, (v) =>
      patchStyle({ fill: v }),
    );
    this.styleTokenSelect('Stroke', 'Stroke color', STROKE_TOKENS, shape.style?.stroke, (v) =>
      patchStyle({ stroke: v }),
    );
    this.styleNumber('Stroke width', 'Stroke width', shape.style?.strokeWidth ?? 1.5, (v) =>
      patchStyle({ strokeWidth: Math.max(0, v) }),
    );
    this.styleTokenSelect('Text color', 'Text color', TEXT_TOKENS, shape.style?.textColor, (v) =>
      patchStyle({ textColor: v }),
    );
    this.styleNumber('Font size', 'Font size', shape.style?.fontSize ?? 13, (v) =>
      patchStyle({ fontSize: Math.max(1, v) }),
    );
  }

  /**
   * A token-name select bound to a style property. Selecting "Default" (value
   * `''`) clears the override (passes `undefined` to the applier).
   */
  private styleTokenSelect(
    label: string,
    ariaName: string,
    tokens: ReadonlyArray<{ value: string; label: string }>,
    current: string | undefined,
    apply: (value: string | undefined) => void,
  ): void {
    const host = this.field(label);
    const select = new Select(host, {
      options: tokens.map((t) => ({ value: t.value, label: t.label })),
      value: current ?? '',
      ariaLabel: ariaName,
    });
    select.on('change', (p: { value: string | undefined }) => {
      apply(p.value ? p.value : undefined);
    });
    this.children.push(select);
  }

  /** A numeric style control (e.g. stroke width, font size). */
  private styleNumber(
    label: string,
    ariaName: string,
    value: number,
    apply: (v: number) => void,
  ): void {
    const host = this.field(label);
    const f = new NumberField(host, { value: String(value), ariaLabel: ariaName });
    f.on(
      'change' as never,
      ((p: { numericValue: number | null }) => {
        if (p.numericValue == null) return;
        apply(p.numericValue);
      }) as never,
    );
    this.children.push(f);
  }

  private renderConnector(connector: ConnectorModel): void {
    const labelHost = this.field('Label');
    const labelField = new TextField(labelHost, {
      value: connector.label ?? '',
      ariaLabel: 'Label',
    });
    labelField.on('change', (p: { value: string }) => {
      this.config.onConnectorChange?.(connector.id, { label: p.value });
      this.emit('edit', { id: connector.id });
    });
    this.children.push(labelField);

    const kindHost = this.field('Routing');
    const options: SelectOption[] = CONNECTOR_KINDS.map((k) => ({
      value: k,
      label: k,
    }));
    const select = new Select(kindHost, {
      options,
      value: connector.kind,
      ariaLabel: 'Routing',
    });
    select.on('change', (p: { value: string | undefined }) => {
      if (!p.value) return;
      this.config.onConnectorChange?.(connector.id, {
        kind: p.value as ConnectorKind,
      });
      this.emit('edit', { id: connector.id });
    });
    this.children.push(select);

    // Arrowheads (start + end).
    const arrowSelect = (
      label: string,
      ariaName: string,
      current: ArrowHead | undefined,
      apply: (head: ArrowHead) => void,
    ): void => {
      const host = this.field(label);
      const sel = new Select(host, {
        options: ARROW_HEADS.map((h) => ({ value: h, label: h })),
        value: current ?? 'none',
        ariaLabel: ariaName,
      });
      sel.on('change', (p: { value: string | undefined }) => {
        if (!p.value) return;
        apply(p.value as ArrowHead);
        this.emit('edit', { id: connector.id });
      });
      this.children.push(sel);
    };
    arrowSelect('Start arrow', 'Start arrowhead', connector.arrows?.start, (head) => {
      this.config.onConnectorChange?.(connector.id, {
        arrows: { ...(connector.arrows ?? {}), start: head },
      });
    });
    arrowSelect('End arrow', 'End arrowhead', connector.arrows?.end ?? 'arrow', (head) => {
      this.config.onConnectorChange?.(connector.id, {
        arrows: { ...(connector.arrows ?? {}), end: head },
      });
    });

    // Connector style: stroke color + width.
    const patchStyle = (over: Record<string, unknown>): void => {
      const next = mergeStyle(connector.style, over);
      this.config.onConnectorChange?.(connector.id, { style: next });
      this.emit('edit', { id: connector.id });
    };
    const strokeHost = this.field('Stroke');
    const strokeSelect = new Select(strokeHost, {
      options: STROKE_TOKENS.map((t) => ({ value: t.value, label: t.label })),
      value: connector.style?.stroke ?? '',
      ariaLabel: 'Stroke color',
    });
    strokeSelect.on('change', (p: { value: string | undefined }) => {
      patchStyle({ stroke: p.value ? p.value : undefined });
    });
    this.children.push(strokeSelect);

    const widthHost = this.field('Stroke width');
    const widthField = new NumberField(widthHost, {
      value: String(connector.style?.strokeWidth ?? 1.5),
      ariaLabel: 'Stroke width',
    });
    widthField.on(
      'change' as never,
      ((p: { numericValue: number | null }) => {
        if (p.numericValue == null) return;
        patchStyle({ strokeWidth: Math.max(0, p.numericValue) });
      }) as never,
    );
    this.children.push(widthField);
  }

  override destroy(): void {
    this.disposeChildren();
    super.destroy();
  }
}
