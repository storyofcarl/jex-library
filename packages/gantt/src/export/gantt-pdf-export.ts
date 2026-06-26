/**
 * `GanttPdfExportFeature` — wires the paginated PDF export (`./pdf`) into a live
 * `Gantt` as a real, reachable public feature, WITHOUT editing the `Gantt` widget
 * class, the frozen contract, or any other shared module. This is the
 * missing-parity "Export to PDF" wiring: `./pdf` implements the full-chart
 * capture → tile-across-pages → header/footer assembly, but nothing exposed it on
 * the widget. This feature is that bridge, mirroring `GanttImageExportFeature`.
 *
 * ## Design (concurrency-safe, contract-pure)
 *   - It is a `GanttFeature` — installed via
 *     `gantt.use(new GanttPdfExportFeature())`,
 *     `new Gantt(el, { plugins: [new GanttPdfExportFeature()] })`, or the
 *     `installPdfExport(gantt)` convenience. It touches ONLY the public
 *     `GanttApi` surface (`el`, `track`) — never the widget internals.
 *   - On `init(api)` it constructs a {@link GanttPdfExporter} bound to the Gantt
 *     root (`api.el`), then grafts `exportPdf()`, `exportPdfBytes()`,
 *     `planPdf()`, and a `pdfExporter` accessor onto the live api/widget object —
 *     additively, via non-enumerable configurable own-properties — so a consumer
 *     can call `gantt.exportPdf()` directly. The graft is removed and the exporter
 *     disposed on `destroy()`/`removeFeature`, so teardown leaks nothing.
 *   - The capture relies on the `'.jects-gantt__timeline-scroller'` /
 *     `'.jects-gantt__tree-scroller'` selectors the widget renders, so the
 *     full-chart paginated capture finds the panes on a real `Gantt` root.
 *
 * ## Why a feature and not a method on the class
 * Other feature agents edit `gantt.ts` in parallel; mutating the class would
 * conflict and risk the frozen-contract surface. A `GanttFeature` is the
 * package's established additive extension seam (see `GanttImageExportFeature`,
 * `GanttIndicatorsFeature`, `ProjectLines`). The integrator can optionally
 * promote `exportPdf()` to a first-class method on `Gantt`; see the wire notes.
 */

import type { Model } from '@jects/core';
import type { GanttApi, GanttFeature } from '../contract.js';
import {
  GanttPdfExporter,
  type GanttPdfExportOptions,
  type PdfPlan,
} from './pdf.js';

/** Registry name this feature installs under (`gantt.features.get(...)`). */
export const GANTT_PDF_EXPORT_FEATURE = 'gantt-pdf-export';

/** Construction config for {@link GanttPdfExportFeature}. */
export interface GanttPdfExportFeatureConfig {
  /**
   * Default options merged into every `exportPdf()`/`planPdf()` call (per-call
   * options win). Lets a consumer set a project-wide page size / orientation /
   * fit / header / footer once at install time.
   */
  defaults?: GanttPdfExportOptions;
  /**
   * Element whose computed `--jects-*` token cascade is inlined into the export
   * (defaults to the Gantt root). Override to resolve tokens from a themed
   * ancestor when the root itself does not carry the theme.
   */
  host?: HTMLElement;
}

/**
 * The PDF-export surface this feature grafts onto the Gantt instance. After
 * `gantt.use(new GanttPdfExportFeature())`, the `gantt` object satisfies
 * {@link GanttWithPdfExport} and these methods are callable directly.
 */
export interface GanttPdfExportApi {
  /**
   * Capture the full export-rendered Gantt and produce a **paginated PDF** as a
   * `Blob` (`application/pdf`). Always resolves a Blob — under jsdom the pages
   * carry header/footer bands only (no rasterized tiles), in a real browser each
   * page carries its rasterized chart tile. When `opts.download` is set, the PDF
   * is also offered as a file download.
   */
  exportPdf(opts?: GanttPdfExportOptions): Promise<Blob | null>;
  /** Like {@link exportPdf} but resolves the raw `Uint8Array` bytes. */
  exportPdfBytes(opts?: GanttPdfExportOptions): Promise<Uint8Array | null>;
  /**
   * Compute the pagination plan (page count / columns / rows / per-page tiles)
   * WITHOUT capturing — pure geometry. Useful to preview the page layout.
   */
  planPdf(opts?: GanttPdfExportOptions): PdfPlan;
  /** The underlying disposable PDF-export controller. */
  readonly pdfExporter: GanttPdfExporter;
}

/** A `Gantt`/`GanttApi` augmented with the PDF-export surface. */
export type GanttWithPdfExport<T extends Model = Model> = GanttApi<T> &
  GanttPdfExportApi;

/** Keys this feature defines on the host so teardown can remove exactly them. */
const GRAFTED_KEYS = [
  'exportPdf',
  'exportPdfBytes',
  'planPdf',
  'pdfExporter',
] as const;

/**
 * The PDF-export `GanttFeature`. Install once per Gantt; installing a second
 * instance is rejected by the widget's feature registry (same `name`).
 */
export class GanttPdfExportFeature<T extends Model = Model>
  implements GanttFeature<T>
{
  readonly name = GANTT_PDF_EXPORT_FEATURE;

  private readonly config: GanttPdfExportFeatureConfig;
  private exporter: GanttPdfExporter | null = null;
  private host: (GanttApi<T> & Record<string, unknown>) | null = null;

  constructor(config: GanttPdfExportFeatureConfig = {}) {
    this.config = config;
  }

  /** Whether the feature has been installed and not yet torn down. */
  get installed(): boolean {
    return this.exporter !== null;
  }

  /** The underlying controller, or `null` before `init` / after `destroy`. */
  get controller(): GanttPdfExporter | null {
    return this.exporter;
  }

  init(api: GanttApi<T>): void {
    const root = api.el;
    const tokenHost = this.config.host ?? root;
    const exporter = new GanttPdfExporter(root, tokenHost);
    this.exporter = exporter;

    const defaults = this.config.defaults ?? {};
    const merge = (opts?: GanttPdfExportOptions): GanttPdfExportOptions => ({
      ...defaults,
      ...opts,
    });

    const surface: GanttPdfExportApi = {
      exportPdf: (opts) => exporter.export(merge(opts)),
      exportPdfBytes: (opts) => exporter.bytes(merge(opts)),
      planPdf: (opts) => exporter.plan(merge(opts)),
      get pdfExporter() {
        return exporter;
      },
    };

    // Graft the surface onto the live api/widget object additively. Defined
    // own-properties (non-enumerable, configurable) read like real methods, do
    // not pollute enumeration/serialization, and can be removed cleanly on
    // teardown without disturbing anything the widget owns.
    const host = api as GanttApi<T> & Record<string, unknown>;
    this.host = host;
    const descriptors: PropertyDescriptorMap = {};
    for (const key of GRAFTED_KEYS) {
      const desc = Object.getOwnPropertyDescriptor(surface, key)!;
      descriptors[key] = { ...desc, configurable: true, enumerable: false };
    }
    Object.defineProperties(host, descriptors);

    // Belt-and-braces: dispose if the host is destroyed first.
    api.track(() => this.destroy());
  }

  destroy(): void {
    const host = this.host;
    if (host) {
      for (const key of GRAFTED_KEYS) {
        const desc = Object.getOwnPropertyDescriptor(host, key);
        if (desc && desc.configurable) delete host[key];
      }
      this.host = null;
    }
    this.exporter?.destroy();
    this.exporter = null;
  }
}

/** Factory mirroring the `createGanttImageExport` / `createProgressLine` shape. */
export function createGanttPdfExport<T extends Model = Model>(
  config: GanttPdfExportFeatureConfig = {},
): GanttPdfExportFeature<T> {
  return new GanttPdfExportFeature<T>(config);
}

/**
 * Install the PDF-export feature onto a live Gantt and return the same instance,
 * narrowed to {@link GanttWithPdfExport} so `gantt.exportPdf()` is statically
 * reachable:
 *
 * ```ts
 * const gantt = installPdfExport(new Gantt(el, { tasks }));
 * const blob = await gantt.exportPdf({ page: 'A4', orientation: 'landscape',
 *   fitToWidth: true, header: { left: 'Project Plan' }, download: 'plan.pdf' });
 * ```
 *
 * The passed object must expose `use(feature)` (every `Gantt` does); the feature
 * is registered so it is also reachable via `gantt.features.get('gantt-pdf-export')`.
 */
export function installPdfExport<
  T extends Model = Model,
  G extends GanttApi<T> & { use(f: GanttFeature<T>): GanttFeature<T> } = GanttApi<T> & {
    use(f: GanttFeature<T>): GanttFeature<T>;
  },
>(gantt: G, config: GanttPdfExportFeatureConfig = {}): G & GanttPdfExportApi {
  gantt.use(new GanttPdfExportFeature<T>(config));
  return gantt as G & GanttPdfExportApi;
}
