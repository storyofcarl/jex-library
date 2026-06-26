/**
 * JSON serialization — convert the model graph to/from a plain, structured-
 * clonable {@link DiagramDocument} and back.
 *
 * Goals:
 *   - `toDocument` produces a deep, plain-object snapshot (safe for
 *     `JSON.stringify` / `structuredClone`) with a stable `version`.
 *   - `fromDocument` rehydrates and *normalizes* a document, tolerating
 *     partial / older inputs (missing arrays, missing `kind`, missing sizes)
 *     by filling defaults — round-trips never throw on well-formed data.
 */

import type {
  DiagramDocument,
  DiagramMode,
  ShapeModel,
  ConnectorModel,
  SwimlaneModel,
  ShapeType,
  ConnectorKind,
  LaneOrientation,
} from '../contract.js';
import { getBuiltinShape } from './shapes.js';

/** Current document schema version. */
export const DOCUMENT_VERSION = 1;

const VALID_MODES: readonly DiagramMode[] = ['flowchart', 'orgchart', 'mindmap', 'pert'];
const VALID_KINDS: readonly ConnectorKind[] = ['straight', 'elbow', 'orthogonal', 'curved'];

/* ── Serialize ────────────────────────────────────────────────────────────── */

export interface SerializeInput {
  mode: DiagramMode;
  shapes: readonly ShapeModel[];
  connectors: readonly ConnectorModel[];
  swimlanes: readonly SwimlaneModel[];
  meta?: Record<string, unknown>;
}

/** Build a plain JSON document snapshot. */
export function toDocument(input: SerializeInput): DiagramDocument {
  const doc: DiagramDocument = {
    version: DOCUMENT_VERSION,
    mode: input.mode,
    shapes: input.shapes.map(cloneShape),
    connectors: input.connectors.map(cloneConnector),
  };
  if (input.swimlanes.length > 0) {
    doc.swimlanes = input.swimlanes.map(cloneSwimlane);
  }
  if (input.meta && Object.keys(input.meta).length > 0) {
    doc.meta = deepClonePlain(input.meta);
  }
  return doc;
}

function cloneShape(s: ShapeModel): ShapeModel {
  return deepClonePlain(s) as ShapeModel;
}
function cloneConnector(c: ConnectorModel): ConnectorModel {
  return deepClonePlain(c) as ConnectorModel;
}
function cloneSwimlane(l: SwimlaneModel): SwimlaneModel {
  return deepClonePlain(l) as SwimlaneModel;
}

/** Structured-clone-equivalent for plain JSON-ish values. */
export function deepClonePlain<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(deepClonePlain) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = deepClonePlain(v);
  }
  return out as T;
}

/* ── Deserialize / normalize ──────────────────────────────────────────────── */

export interface NormalizedDocument {
  version: number;
  mode: DiagramMode;
  shapes: ShapeModel[];
  connectors: ConnectorModel[];
  swimlanes: SwimlaneModel[];
  meta: Record<string, unknown>;
}

/**
 * Rehydrate + normalize a (possibly partial) document. Invalid enum values
 * fall back to sane defaults; missing geometry is filled from the shape's
 * built-in default size.
 */
export function fromDocument(doc: Partial<DiagramDocument> | null | undefined): NormalizedDocument {
  const mode = isMode(doc?.mode) ? doc!.mode : 'flowchart';
  const rawShapes = Array.isArray(doc?.shapes) ? doc!.shapes : [];
  const rawConnectors = Array.isArray(doc?.connectors) ? doc!.connectors : [];
  const rawLanes = Array.isArray(doc?.swimlanes) ? doc!.swimlanes : [];

  const shapes = rawShapes.map(normalizeShape).filter((s): s is ShapeModel => s !== null);
  const seen = new Set(shapes.map((s) => s.id));
  const connectors = rawConnectors
    .map(normalizeConnector)
    .filter((c): c is ConnectorModel => c !== null)
    // drop dangling connectors whose endpoints no longer exist
    .filter((c) => seen.has(c.from.shape) && seen.has(c.to.shape));
  const swimlanes = rawLanes
    .map(normalizeSwimlane)
    .filter((l): l is SwimlaneModel => l !== null);

  return {
    version: typeof doc?.version === 'number' ? doc!.version : DOCUMENT_VERSION,
    mode,
    shapes,
    connectors,
    swimlanes,
    meta: doc?.meta && typeof doc.meta === 'object' ? deepClonePlain(doc.meta) : {},
  };
}

function normalizeShape(raw: unknown): ShapeModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<ShapeModel>;
  if (s.id == null) return null;
  const type = (typeof s.type === 'string' ? s.type : 'rect') as ShapeType;
  const def = getBuiltinShape(type);
  const dw = def?.defaultSize.width ?? 120;
  const dh = def?.defaultSize.height ?? 64;
  const out: ShapeModel = {
    id: String(s.id),
    type,
    x: num(s.x, 0),
    y: num(s.y, 0),
    w: num(s.w, dw),
    h: num(s.h, dh),
  };
  if (typeof s.text === 'string') out.text = s.text;
  if (s.style && typeof s.style === 'object') out.style = deepClonePlain(s.style);
  if (Array.isArray(s.ports)) out.ports = deepClonePlain(s.ports);
  if (typeof s.rotation === 'number') out.rotation = s.rotation;
  if (s.parent != null) out.parent = String(s.parent);
  if (s.lane != null) out.lane = String(s.lane);
  if (typeof s.z === 'number') out.z = s.z;
  if (typeof s.locked === 'boolean') out.locked = s.locked;
  if (s.data && typeof s.data === 'object') out.data = deepClonePlain(s.data);
  if (typeof s.shapeDef === 'string') out.shapeDef = s.shapeDef;
  return out;
}

function normalizeConnector(raw: unknown): ConnectorModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<ConnectorModel>;
  if (c.id == null || !c.from || !c.to) return null;
  const fromShape = (c.from as { shape?: unknown }).shape;
  const toShape = (c.to as { shape?: unknown }).shape;
  if (fromShape == null || toShape == null) return null;
  const kind = isKind(c.kind) ? c.kind : 'orthogonal';
  const out: ConnectorModel = {
    id: String(c.id),
    from: {
      shape: String(fromShape),
      ...(typeof (c.from as { port?: unknown }).port === 'string'
        ? { port: String((c.from as { port?: unknown }).port) }
        : {}),
    },
    to: {
      shape: String(toShape),
      ...(typeof (c.to as { port?: unknown }).port === 'string'
        ? { port: String((c.to as { port?: unknown }).port) }
        : {}),
    },
    kind,
  };
  if (c.arrows && typeof c.arrows === 'object') out.arrows = deepClonePlain(c.arrows);
  if (typeof c.label === 'string') out.label = c.label;
  if (c.style && typeof c.style === 'object') out.style = deepClonePlain(c.style);
  if (Array.isArray(c.points)) out.points = deepClonePlain(c.points);
  if (typeof c.pinned === 'boolean') out.pinned = c.pinned;
  if (typeof c.z === 'number') out.z = c.z;
  if (c.data && typeof c.data === 'object') out.data = deepClonePlain(c.data);
  return out;
}

function normalizeSwimlane(raw: unknown): SwimlaneModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Partial<SwimlaneModel>;
  if (l.id == null) return null;
  const orientation: LaneOrientation =
    l.orientation === 'vertical' ? 'vertical' : 'horizontal';
  const out: SwimlaneModel = {
    id: String(l.id),
    orientation,
    x: num(l.x, 0),
    y: num(l.y, 0),
    w: num(l.w, 200),
    h: num(l.h, 200),
  };
  if (typeof l.title === 'string') out.title = l.title;
  if (l.parent != null) out.parent = String(l.parent);
  if (typeof l.order === 'number') out.order = l.order;
  if (l.style && typeof l.style === 'object') out.style = deepClonePlain(l.style);
  if (l.data && typeof l.data === 'object') out.data = deepClonePlain(l.data);
  return out;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function isMode(v: unknown): v is DiagramMode {
  return typeof v === 'string' && (VALID_MODES as readonly string[]).includes(v);
}
function isKind(v: unknown): v is ConnectorKind {
  return typeof v === 'string' && (VALID_KINDS as readonly string[]).includes(v);
}
